"use server";

import { db } from "@/db";
import {
  purchaseRequisition,
  purchaseRequisitionItem,
  purchaseRequisitionCounter,
  salesOrder,
  salesOrderItem,
  customerPurchaseOrder,
  product,
  supplier,
  user,
  stockLevel,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, desc, asc, inArray, notInArray, isNotNull, isNull, ne, ilike, or } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getNumberingConfig } from "@/server/document-numbering";
import { buildDocumentNo } from "@/lib/document-numbering";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});
// Isolated bucket for PR/PO item image attachments — never touches the product catalog bucket.
const PROCUREMENT_DOCS_BUCKET = process.env.R2_PROCUREMENT_IMAGES_BUCKET!;

export async function getPrItemImageUploadUrl(
  filename: string
): Promise<{ uploadUrl: string; key: string }> {
  await requireAccess("purchase-requisition:create");
  const key = `pr-item-images/${nanoid()}-${filename}`;
  const cmd = new PutObjectCommand({ Bucket: PROCUREMENT_DOCS_BUCKET, Key: key });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
  return { uploadUrl, key };
}

export async function getPrItemImageDownloadUrl(key: string): Promise<string> {
  await requireAccess("purchase-requisition:read");
  const cmd = new GetObjectCommand({ Bucket: PROCUREMENT_DOCS_BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: 7200 });
}

export async function deleteProcurementImages(keys: string[]): Promise<void> {
  if (!keys.length) return;
  await requireAccess("purchase-requisition:create");
  await Promise.allSettled(
    keys.map((key) => s3.send(new DeleteObjectCommand({ Bucket: PROCUREMENT_DOCS_BUCKET, Key: key }))),
  );
}

async function getSession() {
  const session = await getCachedSession();
  if (!session) throw new Error("You must be signed in to continue");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  return { session, orgId, userId: session.user.id };
}

async function requireAccess(permission: string) {
  const { session, orgId, userId } = await getSession();
  const perms = await getUserPermissions(userId, orgId);
  if (!hasAccess(perms, permission)) throw new Error("You don't have permission to do this");
  return { session, orgId, userId };
}

async function generatePrNo(orgId: string): Promise<string> {
  const cfg = await getNumberingConfig(orgId, "pr");
  const year = new Date().getFullYear();
  const existing = await db
    .select()
    .from(purchaseRequisitionCounter)
    .where(eq(purchaseRequisitionCounter.organizationId, orgId))
    .limit(1);
  let nextNo: number;
  if (existing.length === 0) {
    await db.insert(purchaseRequisitionCounter).values({ id: nanoid(), organizationId: orgId, year, lastNumber: 1 });
    nextNo = 1;
  } else {
    const counter = existing[0];
    nextNo = counter.year === year ? counter.lastNumber + 1 : 1;
    await db.update(purchaseRequisitionCounter).set({ year, lastNumber: nextNo }).where(eq(purchaseRequisitionCounter.organizationId, orgId));
  }
  return buildDocumentNo(cfg, year, nextNo);
}

// ── Types ──────────────────────────────────────────────────────────────────

export type PrRow = typeof purchaseRequisition.$inferSelect;
export type PrItemRow = typeof purchaseRequisitionItem.$inferSelect;
export type PrItemRowEnriched = PrItemRow & {
  imageUrl: string | null;
  cpoNo: string | null;
  customerName: string | null;
  customerOrganization: string | null;
  descriptionSource: "so" | "catalog" | "user" | null;
  isAdditional: boolean;
  editedBy: string | null;
};
export type PrWithItems = PrRow & { items: PrItemRowEnriched[]; requestedByName: string | null; approvedByName: string | null };
export type PrListRow = PrRow & { requestedByName: string | null; itemCount: number };

export interface PrItemInput {
  rowNo: number;
  productId?: string;
  productCode?: string;
  description?: string;
  qty?: string;
  uom?: string;
  estimatedUnitCost?: string;
  currency?: string;
  preferredSupplierId?: string;
  preferredSupplierName?: string;
  imageKey?: string;
  descriptionSource?: "so" | "catalog" | "user" | null;
  isAdditional?: boolean;
  editedBy?: string | null;
  cpoNo?: string | null;
  customerName?: string | null;
  customerOrganization?: string | null;
  setGroupId?: string | null;
  setGroupLabel?: string | null;
  setQty?: string | null;
}

export interface CreatePrInput {
  salesOrderId?: string;
  salesOrderNo?: string;
  customerPoId?: string;
  customerPoNo?: string;
  notes?: string;
  prType?: "customer_order" | "replenishment" | "sample_demo";
  samplePurpose?: string;
  items: PrItemInput[];
}

export interface UpdatePrInput extends CreatePrInput {
  id: string;
}

// ── Queries ────────────────────────────────────────────────────────────────

export async function getPurchaseRequisitions(): Promise<PrListRow[]> {
  const { orgId } = await requireAccess("purchase-requisition:read");
  const rows = await db
    .select()
    .from(purchaseRequisition)
    .where(eq(purchaseRequisition.organizationId, orgId))
    .orderBy(desc(purchaseRequisition.createdAt));

  if (rows.length === 0) return [];

  const userIds = [...new Set(rows.map((r) => r.requestedBy))];
  const users = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds));
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? null;

  const prIds = rows.map((r) => r.id);
  const itemCounts = await db
    .select({ purchaseRequisitionId: purchaseRequisitionItem.purchaseRequisitionId })
    .from(purchaseRequisitionItem)
    .where(inArray(purchaseRequisitionItem.purchaseRequisitionId, prIds));
  const countMap = new Map<string, number>();
  for (const i of itemCounts) {
    countMap.set(i.purchaseRequisitionId, (countMap.get(i.purchaseRequisitionId) ?? 0) + 1);
  }

  return rows.map((r) => ({ ...r, requestedByName: nameOf(r.requestedBy), itemCount: countMap.get(r.id) ?? 0 }));
}

export async function getPurchaseRequisitionDetail(id: string): Promise<PrWithItems | null> {
  const { orgId } = await requireAccess("purchase-requisition:read");
  const [row] = await db
    .select()
    .from(purchaseRequisition)
    .where(and(eq(purchaseRequisition.id, id), eq(purchaseRequisition.organizationId, orgId)));
  if (!row) return null;

  const rawItems = await db
    .select()
    .from(purchaseRequisitionItem)
    .where(eq(purchaseRequisitionItem.purchaseRequisitionId, id))
    .orderBy(asc(purchaseRequisitionItem.rowNo));

  // Resolve presigned image URLs
  const withImages = await Promise.all(
    rawItems.map(async (i) => {
      let imageUrl: string | null = null;
      if (i.imageKey) {
        try {
          const cmd = new GetObjectCommand({ Bucket: PROCUREMENT_DOCS_BUCKET, Key: i.imageKey });
          imageUrl = await getSignedUrl(s3, cmd, { expiresIn: 7200 });
        } catch {}
      }
      return { ...i, imageUrl };
    }),
  );

  // Derive per-item CPO / customer info by matching against the linked SO's CPOs
  type CpoMeta = { cpoNo: string | null; customerName: string | null; customerOrganization: string | null };
  const cpoMetaMap = new Map<string, CpoMeta>(); // keyed by rawItem.id

  if (row.salesOrderId) {
    const cpos = await db
      .select({
        id: customerPurchaseOrder.id,
        customerPoNo: customerPurchaseOrder.customerPoNo,
        customerSnapshot: customerPurchaseOrder.customerSnapshot,
        items: customerPurchaseOrder.items,
      })
      .from(customerPurchaseOrder)
      .where(and(eq(customerPurchaseOrder.salesOrderId, row.salesOrderId), eq(customerPurchaseOrder.organizationId, orgId)));

    for (const ri of rawItems) {
      for (const cpo of cpos) {
        const hit = ((cpo.items ?? []) as { productCode?: string; description?: string }[]).some((ci) =>
          (ri.productCode && ci.productCode && ci.productCode === ri.productCode) ||
          (ri.description && ci.description && ci.description === ri.description),
        );
        if (hit) {
          const snap = cpo.customerSnapshot as { name?: string; organizationName?: string } | null;
          cpoMetaMap.set(ri.id, {
            cpoNo: cpo.customerPoNo,
            customerName: snap?.name ?? null,
            customerOrganization: snap?.organizationName ?? null,
          });
          break;
        }
      }
    }
  }

  const items: PrItemRowEnriched[] = withImages.map((i) => {
    // Use stored values; fall back to dynamically matched CPO meta for old records that predate storage
    const stored = { cpoNo: i.cpoNo ?? null, customerName: i.customerName ?? null, customerOrganization: i.customerOrganization ?? null };
    const hasStored = stored.cpoNo || stored.customerName || stored.customerOrganization;
    const meta = hasStored ? stored : (cpoMetaMap.get(i.id) ?? { cpoNo: null, customerName: null, customerOrganization: null });
    const descriptionSource = (i.descriptionSource as "so" | "catalog" | "user" | null) ?? null;
    return { ...i, ...meta, descriptionSource, isAdditional: i.isAdditional ?? false, editedBy: i.editedBy ?? null };
  });

  const userIds = [row.requestedBy, ...(row.approvedBy ? [row.approvedBy] : [])];
  const users = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds));
  const nameOf = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? null;

  return { ...row, items, requestedByName: nameOf(row.requestedBy), approvedByName: nameOf(row.approvedBy) };
}

export async function getPrsBySoId(soId: string): Promise<PrListRow[]> {
  const { orgId } = await requireAccess("purchase-requisition:read");
  const rows = await db
    .select()
    .from(purchaseRequisition)
    .where(and(eq(purchaseRequisition.salesOrderId, soId), eq(purchaseRequisition.organizationId, orgId)))
    .orderBy(asc(purchaseRequisition.createdAt));

  if (rows.length === 0) return [];

  const userIds = [...new Set(rows.map((r) => r.requestedBy))];
  const users = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds));
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? null;

  const prIds = rows.map((r) => r.id);
  const allItems = await db
    .select({ purchaseRequisitionId: purchaseRequisitionItem.purchaseRequisitionId })
    .from(purchaseRequisitionItem)
    .where(inArray(purchaseRequisitionItem.purchaseRequisitionId, prIds));
  const countMap = new Map<string, number>();
  for (const i of allItems) {
    countMap.set(i.purchaseRequisitionId, (countMap.get(i.purchaseRequisitionId) ?? 0) + 1);
  }

  return rows.map((r) => ({ ...r, requestedByName: nameOf(r.requestedBy), itemCount: countMap.get(r.id) ?? 0 }));
}

// ── Mutations ──────────────────────────────────────────────────────────────

export async function createPurchaseRequisition(input: CreatePrInput): Promise<PrRow> {
  const { orgId, userId } = await requireAccess("purchase-requisition:create");
  const prNo = await generatePrNo(orgId);

  // Derive salesOrderNo from salesOrderId if client didn't supply it
  let resolvedSoNo = input.salesOrderNo ?? null;
  if (input.salesOrderId && !resolvedSoNo) {
    const [so] = await db.select({ soNo: salesOrder.soNo }).from(salesOrder).where(eq(salesOrder.id, input.salesOrderId));
    resolvedSoNo = so?.soNo ?? null;
  }

  const [row] = await db.insert(purchaseRequisition).values({
    id: nanoid(),
    organizationId: orgId,
    prNo,
    salesOrderId:  input.salesOrderId  ?? null,
    salesOrderNo:  resolvedSoNo,
    customerPoId:  input.customerPoId  ?? null,
    customerPoNo:  input.customerPoNo  ?? null,
    notes: input.notes ?? null,
    status: "draft",
    prType: input.prType ?? "customer_order",
    samplePurpose: input.samplePurpose ?? null,
    requestedBy: userId,
  }).returning();

  if (input.items.length > 0) {
    await db.insert(purchaseRequisitionItem).values(
      input.items.map((i) => ({
        id: nanoid(),
        purchaseRequisitionId: row.id,
        rowNo: i.rowNo,
        productId: i.productId ?? null,
        productCode: i.productCode ?? null,
        description: i.description ?? null,
        qty: i.qty ?? "1",
        uom: i.uom ?? null,
        estimatedUnitCost: i.estimatedUnitCost ?? "0",
        currency: i.currency ?? "MYR",
        totalEstimatedCost: (
          parseFloat(i.qty ?? "1") * parseFloat(i.estimatedUnitCost ?? "0")
        ).toFixed(2),
        preferredSupplierId: i.preferredSupplierId ?? null,
        preferredSupplierName: i.preferredSupplierName ?? null,
        imageKey: i.imageKey ?? null,
        descriptionSource: i.descriptionSource ?? null,
        isAdditional: i.isAdditional ?? false,
        editedBy: i.editedBy ?? null,
        cpoNo: i.cpoNo ?? null,
        customerName: i.customerName ?? null,
        customerOrganization: i.customerOrganization ?? null,
        setGroupId: i.setGroupId ?? null,
        setGroupLabel: i.setGroupLabel ?? null,
        setQty: i.setQty ?? null,
      })),
    );
  }

  revalidatePath("/dashboard/procurement/requisition");
  return row;
}

export async function updatePurchaseRequisition(input: UpdatePrInput): Promise<PrRow> {
  const { orgId } = await requireAccess("purchase-requisition:update");
  const [existing] = await db
    .select()
    .from(purchaseRequisition)
    .where(and(eq(purchaseRequisition.id, input.id), eq(purchaseRequisition.organizationId, orgId)));
  if (!existing) throw new Error("Purchase requisition not found");
  if (!["draft"].includes(existing.status)) throw new Error("Only draft requisitions can be edited");

  let resolvedSoNo = input.salesOrderNo ?? null;
  if (input.salesOrderId && !resolvedSoNo) {
    const [so] = await db.select({ soNo: salesOrder.soNo }).from(salesOrder).where(eq(salesOrder.id, input.salesOrderId));
    resolvedSoNo = so?.soNo ?? null;
  }

  const [row] = await db.update(purchaseRequisition).set({
    salesOrderId: input.salesOrderId ?? null,
    salesOrderNo: resolvedSoNo,
    notes: input.notes ?? null,
    ...(input.prType !== undefined ? { prType: input.prType } : {}),
    ...(input.samplePurpose !== undefined ? { samplePurpose: input.samplePurpose } : {}),
  }).where(eq(purchaseRequisition.id, input.id)).returning();

  await db.delete(purchaseRequisitionItem).where(eq(purchaseRequisitionItem.purchaseRequisitionId, input.id));
  if (input.items.length > 0) {
    await db.insert(purchaseRequisitionItem).values(
      input.items.map((i) => ({
        id: nanoid(),
        purchaseRequisitionId: input.id,
        rowNo: i.rowNo,
        productId: i.productId ?? null,
        productCode: i.productCode ?? null,
        description: i.description ?? null,
        qty: i.qty ?? "1",
        uom: i.uom ?? null,
        estimatedUnitCost: i.estimatedUnitCost ?? "0",
        currency: i.currency ?? "MYR",
        totalEstimatedCost: (
          parseFloat(i.qty ?? "1") * parseFloat(i.estimatedUnitCost ?? "0")
        ).toFixed(2),
        preferredSupplierId: i.preferredSupplierId ?? null,
        preferredSupplierName: i.preferredSupplierName ?? null,
        imageKey: i.imageKey ?? null,
        descriptionSource: i.descriptionSource ?? null,
        isAdditional: i.isAdditional ?? false,
        editedBy: i.editedBy ?? null,
        cpoNo: i.cpoNo ?? null,
        customerName: i.customerName ?? null,
        customerOrganization: i.customerOrganization ?? null,
        setGroupId: i.setGroupId ?? null,
        setGroupLabel: i.setGroupLabel ?? null,
        setQty: i.setQty ?? null,
      })),
    );
  }

  revalidatePath("/dashboard/procurement/requisition");
  revalidatePath(`/dashboard/procurement/requisition/${input.id}`);
  return row;
}

export async function deletePurchaseRequisition(id: string): Promise<void> {
  const { orgId } = await requireAccess("purchase-requisition:delete");
  const [existing] = await db
    .select()
    .from(purchaseRequisition)
    .where(and(eq(purchaseRequisition.id, id), eq(purchaseRequisition.organizationId, orgId)));
  if (!existing) throw new Error("Purchase requisition not found");
  if (existing.status !== "draft") throw new Error("Only draft requisitions can be deleted");
  await db.delete(purchaseRequisition).where(eq(purchaseRequisition.id, id));
  revalidatePath("/dashboard/procurement/requisition");
  redirect("/dashboard/procurement/requisition");
}

export async function submitPurchaseRequisition(id: string): Promise<void> {
  const { orgId } = await requireAccess("purchase-requisition:create");
  const [existing] = await db
    .select()
    .from(purchaseRequisition)
    .where(and(eq(purchaseRequisition.id, id), eq(purchaseRequisition.organizationId, orgId)));
  if (!existing) throw new Error("Purchase requisition not found");
  if (existing.status !== "draft") throw new Error("Only draft requisitions can be submitted");
  await db.update(purchaseRequisition).set({ status: "submitted" }).where(eq(purchaseRequisition.id, id));
  revalidatePath(`/dashboard/procurement/requisition/${id}`);
  revalidatePath("/dashboard/procurement/requisition");
}

export async function approvePurchaseRequisition(id: string): Promise<void> {
  const { orgId, userId } = await requireAccess("purchase-requisition:approve");
  const [existing] = await db
    .select()
    .from(purchaseRequisition)
    .where(and(eq(purchaseRequisition.id, id), eq(purchaseRequisition.organizationId, orgId)));
  if (!existing) throw new Error("Purchase requisition not found");
  if (existing.status !== "submitted") throw new Error("Only submitted requisitions can be approved");
  await db.update(purchaseRequisition).set({ status: "approved", approvedBy: userId, approvedAt: new Date() }).where(eq(purchaseRequisition.id, id));
  revalidatePath(`/dashboard/procurement/requisition/${id}`);
  revalidatePath("/dashboard/procurement/requisition");
}

export async function rejectPurchaseRequisition(id: string): Promise<void> {
  const { orgId } = await requireAccess("purchase-requisition:approve");
  const [existing] = await db
    .select()
    .from(purchaseRequisition)
    .where(and(eq(purchaseRequisition.id, id), eq(purchaseRequisition.organizationId, orgId)));
  if (!existing) throw new Error("Purchase requisition not found");
  if (existing.status !== "submitted") throw new Error("Only submitted requisitions can be rejected");
  await db.update(purchaseRequisition).set({ status: "draft" }).where(eq(purchaseRequisition.id, id));
  revalidatePath(`/dashboard/procurement/requisition/${id}`);
  revalidatePath("/dashboard/procurement/requisition");
}

export async function cancelPurchaseRequisition(id: string): Promise<void> {
  const { orgId } = await requireAccess("purchase-requisition:update");
  const [existing] = await db
    .select()
    .from(purchaseRequisition)
    .where(and(eq(purchaseRequisition.id, id), eq(purchaseRequisition.organizationId, orgId)));
  if (!existing) throw new Error("Purchase requisition not found");
  if (["ordered", "cancelled"].includes(existing.status)) throw new Error("Cannot cancel this requisition");
  await db.update(purchaseRequisition).set({ status: "cancelled" }).where(eq(purchaseRequisition.id, id));
  revalidatePath(`/dashboard/procurement/requisition/${id}`);
  revalidatePath("/dashboard/procurement/requisition");
}

// ── Helpers for create form ────────────────────────────────────────────────

export async function searchSuppliersForPr(query: string) {
  if (!query.trim()) return [];
  const { orgId } = await requireAccess("purchase-requisition:read");
  return db
    .select({ id: supplier.id, name: supplier.name })
    .from(supplier)
    .where(and(eq(supplier.organizationId, orgId), ilike(supplier.name, `%${query}%`)))
    .orderBy(asc(supplier.name))
    .limit(20);
}

export type CpoLineItem = {
  rowNo: number;
  productCode: string;
  description: string;
  qty: string;
  uom: string;
  unitPrice: string;
  discountPct: string;
  totalPrice: string;
  lineType: string;
};

export async function getCposForSo(soId: string): Promise<{
  id: string;
  customerPoNo: string;
  amount: string;
  currency: string;
  items: CpoLineItem[] | null;
}[]> {
  const { orgId } = await requireAccess("purchase-requisition:read");
  return db
    .select({
      id: customerPurchaseOrder.id,
      customerPoNo: customerPurchaseOrder.customerPoNo,
      amount: customerPurchaseOrder.amount,
      currency: customerPurchaseOrder.currency,
      items: customerPurchaseOrder.items,
    })
    .from(customerPurchaseOrder)
    .where(and(eq(customerPurchaseOrder.salesOrderId, soId), eq(customerPurchaseOrder.organizationId, orgId)))
    .orderBy(asc(customerPurchaseOrder.createdAt));
}

export async function getSoItemsForPr(soId: string) {
  const { orgId } = await requireAccess("purchase-requisition:read");
  const [so] = await db
    .select({ id: salesOrder.id, soNo: salesOrder.soNo, customerPoLinks: salesOrder.customerPoLinks })
    .from(salesOrder)
    .where(and(eq(salesOrder.id, soId), eq(salesOrder.organizationId, orgId)));
  if (!so) return null;

  // Collect CPO IDs from the SO's customerPoLinks JSON (authoritative source)
  type CpoLink = { customerPoId: string; customerPoNo: string };
  const linkedCpoIds = [
    ...new Set(
      ((so.customerPoLinks as CpoLink[] | null) ?? []).map((l) => l.customerPoId).filter(Boolean),
    ),
  ];

  const [items, cpos] = await Promise.all([
    db
      .select({
        id: salesOrderItem.id,
        productId: salesOrderItem.productId,
        productCode: salesOrderItem.productCode,
        description: salesOrderItem.description,
        qty: salesOrderItem.qty,
        uom: salesOrderItem.uom,
        sourceCustomerPoId: salesOrderItem.sourceCustomerPoId,
        sourceCustomerPoNo: salesOrderItem.sourceCustomerPoNo,
        isAdditional: salesOrderItem.isAdditional,
        editedBy: salesOrderItem.editedBy,
        prExcluded: salesOrderItem.prExcluded,
        setGroupId: salesOrderItem.setGroupId,
        setGroupLabel: salesOrderItem.setGroupLabel,
        setQty: salesOrderItem.setQty,
      })
      .from(salesOrderItem)
      .where(eq(salesOrderItem.salesOrderId, soId))
      .orderBy(asc(salesOrderItem.rowNo)),

    linkedCpoIds.length > 0
      ? db
          .select({
            id: customerPurchaseOrder.id,
            customerPoNo: customerPurchaseOrder.customerPoNo,
            customerSnapshot: customerPurchaseOrder.customerSnapshot,
            items: customerPurchaseOrder.items,
          })
          .from(customerPurchaseOrder)
          .where(and(
            eq(customerPurchaseOrder.organizationId, orgId),
            inArray(customerPurchaseOrder.id, linkedCpoIds),
          ))
      : Promise.resolve([]),
  ]);

  // Build direct CPO lookup by ID (primary) and fuzzy match (fallback for legacy items)
  const cpoMap = new Map(cpos.map((c) => [c.id, c]));

  function resolveCpo(sourceCustomerPoId: string | null, productCode: string | null, description: string | null) {
    // Prefer direct link from SO item
    if (sourceCustomerPoId) {
      const cpo = cpoMap.get(sourceCustomerPoId);
      if (cpo) {
        const snap = cpo.customerSnapshot as { title?: string; name?: string; organizationName?: string } | null;
        const name = [snap?.title, snap?.name].filter(Boolean).join(" ") || null;
        return { cpoId: cpo.id, cpoNo: cpo.customerPoNo, customerName: name, customerOrganization: snap?.organizationName ?? null };
      }
    }
    // Fallback: fuzzy match via CPO items array
    for (const cpo of cpos) {
      const hit = (cpo.items ?? []).some((ci: any) =>
        (productCode && ci.productCode && ci.productCode === productCode) ||
        (description && ci.description && ci.description === description)
      );
      if (hit) {
        const snap = cpo.customerSnapshot as { title?: string; name?: string; organizationName?: string } | null;
        const name = [snap?.title, snap?.name].filter(Boolean).join(" ") || null;
        return { cpoId: cpo.id, cpoNo: cpo.customerPoNo, customerName: name, customerOrganization: snap?.organizationName ?? null };
      }
    }
    return null;
  }

  // Enrich with product unit cost
  const productIds = items.map((i) => i.productId).filter(Boolean) as string[];
  const products = productIds.length > 0
    ? await db.select({ id: product.id, costUnitPrice: product.costUnitPrice }).from(product).where(inArray(product.id, productIds))
    : [];
  const costMap = new Map(products.map((p) => [p.id, p.costUnitPrice]));

  // Find product codes already covered by active (non-cancelled) PRs for this SO
  const activePrItems = await db
    .select({ productCode: purchaseRequisitionItem.productCode })
    .from(purchaseRequisitionItem)
    .innerJoin(purchaseRequisition, eq(purchaseRequisitionItem.purchaseRequisitionId, purchaseRequisition.id))
    .where(and(
      eq(purchaseRequisition.salesOrderId, soId),
      eq(purchaseRequisition.organizationId, orgId),
      ne(purchaseRequisition.status, "cancelled"),
    ));
  const coveredCodes = new Set(activePrItems.map((i) => i.productCode).filter(Boolean) as string[]);

  const filteredItems = items.filter((i) =>
    !i.prExcluded &&
    (i.description || i.productCode) &&
    (!i.productCode || !coveredCodes.has(i.productCode))
  );

  return {
    soNo: so.soNo,
    items: filteredItems.map((i, idx) => {
      const cpoMatch = resolveCpo(i.sourceCustomerPoId ?? null, i.productCode, i.description);
      return {
        soItemId:             i.id,
        rowNo: idx + 1,
        productId: i.productId ?? undefined,
        productCode: i.productCode ?? "",
        description: i.description ?? "",
        qty: i.qty ?? "1",
        uom: i.uom ?? "",
        estimatedUnitCost: i.productId ? (costMap.get(i.productId) ?? "0") : "0",
        cpoId:                cpoMatch?.cpoId                 ?? null,
        cpoNo:                cpoMatch?.cpoNo ?? i.sourceCustomerPoNo ?? null,
        customerName:         cpoMatch?.customerName          ?? null,
        customerOrganization: cpoMatch?.customerOrganization  ?? null,
        isAdditional:         i.isAdditional ?? false,
        editedBy:             i.editedBy ?? null,
        setGroupId:           i.setGroupId ?? null,
        setGroupLabel:        i.setGroupLabel ?? null,
        setQty:               i.setQty ?? null,
      };
    }),
  };
}

export async function searchConfirmedSosForPr(query: string) {
  const { orgId } = await requireAccess("purchase-requisition:read");
  return db
    .select({ id: salesOrder.id, soNo: salesOrder.soNo })
    .from(salesOrder)
    .where(and(
      eq(salesOrder.organizationId, orgId),
      inArray(salesOrder.status, ["confirmed", "fulfilled"]),
      or(ilike(salesOrder.soNo, `%${query}%`)),
    ))
    .orderBy(desc(salesOrder.createdAt))
    .limit(20);
}

export async function getOpenSosForPr() {
  const { orgId } = await requireAccess("purchase-requisition:read");
  return db
    .select({ id: salesOrder.id, soNo: salesOrder.soNo })
    .from(salesOrder)
    .where(and(
      eq(salesOrder.organizationId, orgId),
      inArray(salesOrder.status, ["confirmed", "fulfilled"]),
    ))
    .orderBy(desc(salesOrder.createdAt))
    .limit(30);
}

export type PendingSoForPrRow = {
  id: string;
  soNo: string;
  customers: { name: string; organizationName: string | null }[];
  customerPoNos: string[];
  grandTotal: string;
  createdAt: Date;
};

export async function getPendingSosForPr(): Promise<PendingSoForPrRow[]> {
  const { orgId } = await requireAccess("purchase-requisition:read");

  // Fetch all confirmed SOs
  const rows = await db
    .select({
      id: salesOrder.id,
      soNo: salesOrder.soNo,
      customerPoId: salesOrder.customerPoId,
      customerPoNo: salesOrder.customerPoNo,
      customerPoLinks: salesOrder.customerPoLinks,
      grandTotal: salesOrder.grandTotal,
      createdAt: salesOrder.createdAt,
    })
    .from(salesOrder)
    .where(and(
      eq(salesOrder.organizationId, orgId),
      eq(salesOrder.status, "confirmed"),
      or(isNull(salesOrder.stockReservationStatus), ne(salesOrder.stockReservationStatus, "reserved")),
    ))
    .orderBy(desc(salesOrder.createdAt));

  if (rows.length === 0) return [];

  const soIds = rows.map((r) => r.id);

  // For each SO, find which product codes are already covered by active (non-cancelled) PRs
  const activePrItems = await db
    .select({
      salesOrderId: purchaseRequisition.salesOrderId,
      productCode: purchaseRequisitionItem.productCode,
    })
    .from(purchaseRequisitionItem)
    .innerJoin(purchaseRequisition, eq(purchaseRequisitionItem.purchaseRequisitionId, purchaseRequisition.id))
    .where(and(
      eq(purchaseRequisition.organizationId, orgId),
      isNotNull(purchaseRequisition.salesOrderId),
      inArray(purchaseRequisition.salesOrderId, soIds),
      ne(purchaseRequisition.status, "cancelled"),
    ));

  const coveredCodesPerSo = new Map<string, Set<string>>();
  for (const item of activePrItems) {
    if (!item.salesOrderId || !item.productCode) continue;
    if (!coveredCodesPerSo.has(item.salesOrderId)) coveredCodesPerSo.set(item.salesOrderId, new Set());
    coveredCodesPerSo.get(item.salesOrderId)!.add(item.productCode);
  }

  const soItemRows = await db
    .select({ salesOrderId: salesOrderItem.salesOrderId, productCode: salesOrderItem.productCode })
    .from(salesOrderItem)
    .where(and(
      inArray(salesOrderItem.salesOrderId, soIds),
      ne(salesOrderItem.prExcluded, true),
    ));

  const soItemCodesPerSo = new Map<string, Set<string>>();
  for (const item of soItemRows) {
    if (!item.productCode) continue;
    if (!soItemCodesPerSo.has(item.salesOrderId)) soItemCodesPerSo.set(item.salesOrderId, new Set());
    soItemCodesPerSo.get(item.salesOrderId)!.add(item.productCode);
  }

  // Keep only SOs that still have at least one uncovered item
  const pendingRows = rows.filter((r) => {
    const soItemCodes = soItemCodesPerSo.get(r.id);
    if (!soItemCodes || soItemCodes.size === 0) return true;
    const covered = coveredCodesPerSo.get(r.id) ?? new Set<string>();
    return [...soItemCodes].some((code) => !covered.has(code));
  });

  if (pendingRows.length === 0) return [];

  // Collect all CPO IDs referenced by these SOs, then fetch their customer snapshots in one query
  type CpoLink = { customerPoId: string; customerPoNo: string };
  const allCpoIds = [
    ...new Set(
      pendingRows.flatMap((r) => {
        const links = (r.customerPoLinks as CpoLink[] | null) ?? [];
        return links.length > 0
          ? links.map((l) => l.customerPoId)
          : r.customerPoId ? [r.customerPoId] : [];
      }),
    ),
  ];

  const cpoSnapshotMap = new Map<string, { name?: string; organizationName?: string }>();
  if (allCpoIds.length > 0) {
    const cpos = await db
      .select({ id: customerPurchaseOrder.id, customerSnapshot: customerPurchaseOrder.customerSnapshot })
      .from(customerPurchaseOrder)
      .where(inArray(customerPurchaseOrder.id, allCpoIds));
    for (const cpo of cpos) {
      if (cpo.customerSnapshot) cpoSnapshotMap.set(cpo.id, cpo.customerSnapshot as { name?: string; organizationName?: string });
    }
  }

  return pendingRows.map((r) => {
    const links = (r.customerPoLinks as CpoLink[] | null) ?? [];
    const cpoIds = links.length > 0
      ? links.map((l) => l.customerPoId)
      : r.customerPoId ? [r.customerPoId] : [];

    const customerPoNos = links.length > 0
      ? [...new Set(links.map((l) => l.customerPoNo).filter(Boolean))]
      : r.customerPoNo ? [r.customerPoNo] : [];

    // Build deduped customers from CPO snapshots
    const seen = new Set<string>();
    const customers: { name: string; organizationName: string | null }[] = [];
    for (const cpoId of cpoIds) {
      const s = cpoSnapshotMap.get(cpoId);
      const name = s?.name?.trim();
      if (!name) continue;
      const orgName = s?.organizationName?.trim() || null;
      const key = `${name}||${orgName ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      customers.push({ name, organizationName: orgName });
    }

    return {
      id: r.id,
      soNo: r.soNo,
      customers,
      customerPoNos,
      grandTotal: r.grandTotal,
      createdAt: r.createdAt,
    };
  });
}

// ── Replenishment trigger ──────────────────────────────────────────────────
// Called automatically after SO approval. Creates a draft replenishment PR
// for any product whose available stock falls at or below its reorder point,
// provided no pending replenishment PR already covers that product.

export async function checkAndTriggerReplenishment(
  orgId: string,
  userId: string,
  productIds: string[],
): Promise<void> {
  const unique = [...new Set(productIds.filter(Boolean))];
  if (unique.length === 0) return;

  const levels = await db
    .select()
    .from(stockLevel)
    .where(
      and(
        eq(stockLevel.organizationId, orgId),
        eq(stockLevel.warehouseLabel, "Default"),
        inArray(stockLevel.productId, unique),
      ),
    );

  const triggered = levels.filter((lvl) => {
    if (!lvl.reorderPoint) return false;
    const available = parseFloat(lvl.quantity ?? "0") - parseFloat(lvl.reservedQty ?? "0");
    return available <= parseFloat(lvl.reorderPoint);
  });

  if (triggered.length === 0) return;

  const triggeredIds = triggered.map((l) => l.productId);

  // Check for already-pending replenishment PRs for these products
  const existing = await db
    .select({ productId: purchaseRequisitionItem.productId })
    .from(purchaseRequisitionItem)
    .innerJoin(purchaseRequisition, eq(purchaseRequisitionItem.purchaseRequisitionId, purchaseRequisition.id))
    .where(
      and(
        eq(purchaseRequisition.organizationId, orgId),
        eq(purchaseRequisition.prType, "replenishment"),
        inArray(purchaseRequisition.status, ["draft", "submitted", "approved"]),
        inArray(purchaseRequisitionItem.productId, triggeredIds),
      ),
    );

  const alreadyPending = new Set(existing.map((e) => e.productId).filter(Boolean));

  const toCreate = triggered.filter((lvl) => !alreadyPending.has(lvl.productId));
  if (toCreate.length === 0) return;

  // Fetch product details for all products to create PRs for
  const prods = await db
    .select({ id: product.id, productCode: product.productCode, description: product.description, uom: product.uom, costUnitPrice: product.costUnitPrice, costPriceCurrency: product.costPriceCurrency })
    .from(product)
    .where(inArray(product.id, toCreate.map((l) => l.productId)));

  const prodMap = new Map(prods.map((p) => [p.id, p]));

  for (const lvl of toCreate) {
    const prod = prodMap.get(lvl.productId);
    const available = parseFloat(lvl.quantity ?? "0") - parseFloat(lvl.reservedQty ?? "0");
    const reorderQty = lvl.maxStock
      ? Math.max(1, parseFloat(lvl.maxStock) - available)
      : parseFloat(lvl.reorderPoint!);

    const prNo = await generatePrNo(orgId);
    const [row] = await db.insert(purchaseRequisition).values({
      id: nanoid(),
      organizationId: orgId,
      prNo,
      status: "draft",
      prType: "replenishment",
      notes: `Auto-generated: stock fell to or below reorder point (${lvl.reorderPoint} ${prod?.uom ?? "units"})`,
      requestedBy: userId,
    }).returning();

    await db.insert(purchaseRequisitionItem).values({
      id: nanoid(),
      purchaseRequisitionId: row.id,
      rowNo: 1,
      productId: lvl.productId,
      productCode: prod?.productCode ?? null,
      description: prod?.description ?? null,
      qty: String(Math.ceil(reorderQty)),
      uom: prod?.uom ?? null,
      estimatedUnitCost: prod?.costUnitPrice ?? "0",
      currency: prod?.costPriceCurrency ?? "MYR",
      totalEstimatedCost: (Math.ceil(reorderQty) * parseFloat(prod?.costUnitPrice ?? "0")).toFixed(2),
      isAdditional: false,
    });
  }

  revalidatePath("/dashboard/procurement/requisition");
}
