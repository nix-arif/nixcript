"use server";

import { db } from "@/db";
import {
  purchaseOrder,
  purchaseOrderItem,
  purchaseOrderCounter,
  purchaseRequisitionCounter,
  purchaseOrderCustomerPo,
  customerPurchaseOrder,
  purchaseRequisition,
  purchaseRequisitionItem,
  salesOrder,
  salesOrderItem,
  product,
  supplier,
  user,
  organization,
  organizationProfile,
  goodsReceipt,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, desc, asc, inArray, notInArray, sql } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getNumberingConfig } from "@/server/document-numbering";
import { buildDocumentNo } from "@/lib/document-numbering";
import { revalidatePath } from "next/cache";
import { createApprovedMovement } from "@/lib/inventory/create-movement";
import { MOVEMENT_TYPE, REF_TYPE } from "@/lib/inventory/constants";
import { createNotification, getPoApprovers } from "@/server/notifications";

// ── R2 supplier-quotation bucket ───────────────────────────────────────────
const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const SUPPLIER_QUOTATION_BUCKET = process.env.R2_SUPPLIER_QUOTATION_BUCKET!;

export async function getPoSupplierQuotationUploadUrl(
  filename: string,
): Promise<{ key: string; uploadUrl: string }> {
  await requireAccess("purchase-order:create");
  const key = `supplier-quotations/po/${nanoid()}-${filename}`;
  const cmd = new PutObjectCommand({
    Bucket: SUPPLIER_QUOTATION_BUCKET,
    Key: key,
    ContentType: "application/pdf",
  });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
  return { key, uploadUrl };
}

export async function getPoSupplierQuotationDownloadUrl(key: string): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: SUPPLIER_QUOTATION_BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: 3600 });
}

// ── R2 procurement item images (PO/PR attachments — isolated from product catalog) ──
const PROCUREMENT_DOCS_BUCKET = process.env.R2_PROCUREMENT_IMAGES_BUCKET!;

export async function getPoItemImageUploadUrl(
  filename: string,
): Promise<{ key: string; uploadUrl: string }> {
  await requireAccess("purchase-order:create");
  const key = `po-item-images/${nanoid()}-${filename}`;
  const cmd = new PutObjectCommand({ Bucket: PROCUREMENT_DOCS_BUCKET, Key: key });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
  return { key, uploadUrl };
}

export async function getPoItemImageDownloadUrl(key: string): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: PROCUREMENT_DOCS_BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: 3600 });
}

export async function deleteProcurementImages(keys: string[]): Promise<void> {
  if (!keys.length) return;
  await requireAccess("purchase-order:create");
  await Promise.allSettled(
    keys.map((key) => s3.send(new DeleteObjectCommand({ Bucket: PROCUREMENT_DOCS_BUCKET, Key: key }))),
  );
}

async function deleteFile(bucket: string, key: string | null | undefined) {
  if (!key) return;
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

// ── Auth helpers ───────────────────────────────────────────────────────────

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


// ── Running numbers ────────────────────────────────────────────────────────

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
    await db
      .update(purchaseRequisitionCounter)
      .set({ year, lastNumber: nextNo })
      .where(eq(purchaseRequisitionCounter.organizationId, orgId));
  }
  return buildDocumentNo(cfg, year, nextNo);
}

async function generatePoNo(orgId: string): Promise<string> {
  const cfg = await getNumberingConfig(orgId, "po");
  const year = new Date().getFullYear();

  const existing = await db
    .select()
    .from(purchaseOrderCounter)
    .where(eq(purchaseOrderCounter.organizationId, orgId))
    .limit(1);

  let nextNo: number;

  if (existing.length === 0) {
    await db.insert(purchaseOrderCounter).values({ id: nanoid(), organizationId: orgId, year, lastNumber: 1 });
    nextNo = 1;
  } else {
    const counter = existing[0];
    nextNo = counter.year === year ? counter.lastNumber + 1 : 1;
    await db
      .update(purchaseOrderCounter)
      .set({ year, lastNumber: nextNo })
      .where(eq(purchaseOrderCounter.organizationId, orgId));
  }

  return buildDocumentNo(cfg, year, nextNo);
}

// ── Types ──────────────────────────────────────────────────────────────────

export type PurchaseOrderRow = typeof purchaseOrder.$inferSelect;
export type PurchaseOrderItem = typeof purchaseOrderItem.$inferSelect;
export type PurchaseOrderItemEnriched = PurchaseOrderItem & { imageUrl: string | null };

export interface PurchaseOrderItemInput {
  rowNo: number;
  productId?: string;
  productCode?: string;
  description?: string;
  qty?: string;
  uom?: string;
  unitPrice?: string;
  currency?: string;
  totalPrice?: string;
  imageKey?: string;
  customerName?: string;
  customerOrganization?: string;
  customerPoNo?: string;
}

export interface CreatePurchaseOrderInput {
  purchaseRequisitionId?: string; // when set, PO is auto-confirmed (PR approval = authorization)
  salesOrderId?: string;
  supplierId: string;
  supplierQuotationKey?: string;
  customerPoIds?: string[];
  currency?: string;
  sst?: string;
  sstPct?: string;
  subtotal?: string;
  grandTotal?: string;
  notes?: string;
  expectedDeliveryDate?: Date;
  deliveryAddress?: string;
  items: PurchaseOrderItemInput[];
}

// ── PR → PO conversion helper ─────────────────────────────────────────────

export type PrForPoConversion = {
  id: string;
  prNo: string;
  salesOrderId: string | null;
  salesOrderNo: string | null;
  notes: string | null;
  cpoNos: string[]; // all unique CPO numbers across items
  items: Array<{
    id: string;
    rowNo: number;
    productId: string | null;
    productCode: string | null;
    description: string | null;
    qty: string;
    uom: string | null;
    estimatedUnitCost: string;
    currency: string;
    preferredSupplierId: string | null;
    preferredSupplierName: string | null;
    imageKey: string | null;
    imageUrl: string | null;
    cpoNo: string | null;
    cpoId: string | null;
    customerName: string | null;
    customerOrganization: string | null;
    isAdditional: boolean;
    editedBy: string | null;
  }>;
};

export async function getPrForPoConversion(prId: string): Promise<PrForPoConversion | null> {
  const { orgId } = await requireAccess("purchase-order:create");
  const [pr] = await db
    .select()
    .from(purchaseRequisition)
    .where(and(eq(purchaseRequisition.id, prId), eq(purchaseRequisition.organizationId, orgId)));
  if (!pr) return null;
  if (pr.status !== "approved" && pr.status !== "partially_ordered") return null;

  const [items, cpos] = await Promise.all([
    db.select().from(purchaseRequisitionItem)
      .where(eq(purchaseRequisitionItem.purchaseRequisitionId, prId))
      .orderBy(asc(purchaseRequisitionItem.rowNo)),
    // Load CPOs linked to the SO so we can resolve cpoNo → cpoId
    pr.salesOrderId
      ? db.select({ id: customerPurchaseOrder.id, customerPoNo: customerPurchaseOrder.customerPoNo })
          .from(customerPurchaseOrder)
          .where(and(eq(customerPurchaseOrder.salesOrderId, pr.salesOrderId), eq(customerPurchaseOrder.organizationId, orgId)))
      : Promise.resolve([]),
  ]);

  // Map cpoNo → cpoId for quick lookup
  const cpoIdByNo = new Map(cpos.map((c) => [c.customerPoNo, c.id]));

  const enrichedItems = await Promise.all(
    items.map(async (i) => {
      let imageUrl: string | null = null;
      if (i.imageKey) {
        try {
          const cmd = new GetObjectCommand({ Bucket: PROCUREMENT_DOCS_BUCKET, Key: i.imageKey });
          imageUrl = await getSignedUrl(s3, cmd, { expiresIn: 7200 });
        } catch {}
      }
      return {
        id: i.id,
        rowNo: i.rowNo,
        productId: i.productId ?? null,
        productCode: i.productCode ?? null,
        description: i.description ?? null,
        qty: i.qty ?? "1",
        uom: i.uom ?? null,
        estimatedUnitCost: i.estimatedUnitCost ?? "0",
        currency: i.currency ?? "MYR",
        preferredSupplierId: i.preferredSupplierId ?? null,
        preferredSupplierName: i.preferredSupplierName ?? null,
        imageKey: i.imageKey ?? null,
        imageUrl,
        cpoNo: i.cpoNo ?? null,
        cpoId: i.cpoNo ? (cpoIdByNo.get(i.cpoNo) ?? null) : null,
        customerName: i.customerName ?? null,
        customerOrganization: i.customerOrganization ?? null,
        isAdditional: i.isAdditional ?? false,
        editedBy: i.editedBy ?? null,
      };
    }),
  );

  const cpoNos = [...new Set(enrichedItems.map((i) => i.cpoNo).filter(Boolean) as string[])];

  return {
    id: pr.id,
    prNo: pr.prNo,
    salesOrderId: pr.salesOrderId,
    salesOrderNo: pr.salesOrderNo,
    notes: pr.notes,
    cpoNos,
    items: enrichedItems,
  };
}

export interface UpdatePurchaseOrderInput extends Omit<CreatePurchaseOrderInput, "items"> {
  id: string;
  status?: string;
  items: PurchaseOrderItemInput[];
}

// ── Reference data fetchers for PO forms ──────────────────────────────────

export async function getApprovedSalesOrders(): Promise<{ id: string; soNo: string; customerName: string | null }[]> {
  const { orgId } = await requireAccess("purchase-order:read");

  // Show all confirmed SOs — item-level filtering in getSalesOrderItemsForPo handles partial orders
  const rows = await db
    .select({
      id: salesOrder.id,
      soNo: salesOrder.soNo,
      customerSnapshot: salesOrder.customerSnapshot,
    })
    .from(salesOrder)
    .where(
      and(
        eq(salesOrder.organizationId, orgId),
        eq(salesOrder.status, "confirmed"),
      ),
    )
    .orderBy(desc(salesOrder.createdAt));

  return rows.map((r) => {
    const snap = r.customerSnapshot as any;
    return { id: r.id, soNo: r.soNo, customerName: snap?.name ?? null };
  });
}

export async function getActiveCustomerPos(): Promise<{ id: string; customerPoNo: string; customerName: string | null; amount: string }[]> {
  const { orgId } = await requireAccess("purchase-order:read");
  const rows = await db
    .select({
      id: customerPurchaseOrder.id,
      customerPoNo: customerPurchaseOrder.customerPoNo,
      customerSnapshot: customerPurchaseOrder.customerSnapshot,
      amount: customerPurchaseOrder.amount,
    })
    .from(customerPurchaseOrder)
    .where(and(eq(customerPurchaseOrder.organizationId, orgId), inArray(customerPurchaseOrder.status, ["received", "acknowledged"])))
    .orderBy(desc(customerPurchaseOrder.createdAt));
  return rows.map((r) => {
    const snap = r.customerSnapshot as any;
    return { id: r.id, customerPoNo: r.customerPoNo, customerName: snap?.name ?? null, amount: r.amount };
  });
}

export async function getDefaultDeliveryAddress(): Promise<string> {
  const { orgId } = await requireAccess("purchase-order:read");
  const [profile] = await db
    .select({ warehouseAddresses: organizationProfile.warehouseAddresses })
    .from(organizationProfile)
    .where(eq(organizationProfile.organizationId, orgId))
    .limit(1);
  const addresses = (profile?.warehouseAddresses as { label: string; address: string }[] | null) ?? [];
  return addresses[0]?.address ?? "";
}

export interface SoItemForPo {
  rowNo: number;
  productId: string | null;
  productCode: string | null;
  description: string | null;
  qty: string;
  uom: string | null;
  unitPrice: string | null;
  currency: string | null;
  totalPrice: string | null;
  imageKey: string | null;
}

export interface SoItemsForPoResult {
  items: SoItemForPo[];
  orderedProductCodes: string[];
  orderedSupplierIds: string[];
}

export async function getSalesOrderItemsForPo(soId: string): Promise<SoItemsForPoResult> {
  await requireAccess("purchase-order:read");

  // Find active (non-cancelled) POs already linked to this SO
  const activePOs = await db
    .select({ id: purchaseOrder.id, supplierId: purchaseOrder.supplierId })
    .from(purchaseOrder)
    .where(
      and(
        eq(purchaseOrder.salesOrderId, soId),
        sql`${purchaseOrder.status} != 'cancelled'`,
      ),
    );

  const orderedSupplierIds = [...new Set(
    activePOs.map((p) => p.supplierId).filter((id): id is string => !!id),
  )];

  let orderedProductCodes: string[] = [];
  if (activePOs.length > 0) {
    const poIds = activePOs.map((p) => p.id);
    const orderedItems = await db
      .select({ productCode: purchaseOrderItem.productCode })
      .from(purchaseOrderItem)
      .where(inArray(purchaseOrderItem.purchaseOrderId, poIds));
    orderedProductCodes = [...new Set(
      orderedItems.map((i) => i.productCode).filter((c): c is string => !!c),
    )];
  }

  const allItems = await db
    .select()
    .from(salesOrderItem)
    .where(eq(salesOrderItem.salesOrderId, soId))
    .orderBy(asc(salesOrderItem.rowNo));

  if (allItems.length === 0) return { items: [], orderedProductCodes, orderedSupplierIds };

  // Exclude items whose productCode is already covered by an active PO for this SO
  const orderedSet = new Set(orderedProductCodes);
  const unorderedItems = allItems.filter((i) => !i.productCode || !orderedSet.has(i.productCode));

  const codes = unorderedItems.map((i) => i.productCode).filter((c): c is string => !!c);
  const imageMap: Record<string, string | null> = {};
  const costMap: Record<string, string | null> = {};
  const currencyMap: Record<string, string | null> = {};

  if (codes.length > 0) {
    const prods = await db
      .select({ productCode: product.productCode, imageKey: product.imageKey, costUnitPrice: product.costUnitPrice, costPriceCurrency: product.costPriceCurrency })
      .from(product)
      .where(inArray(product.productCode, codes));
    for (const p of prods) {
      imageMap[p.productCode] = p.imageKey ?? null;
      costMap[p.productCode] = p.costUnitPrice ?? null;
      currencyMap[p.productCode] = p.costPriceCurrency ?? null;
    }
  }

  const items = unorderedItems.map((i) => {
    const cost = i.productCode ? (costMap[i.productCode] ?? null) : null;
    const unitPrice = cost ?? "0";
    const qty = parseFloat(i.qty ?? "1");
    const price = parseFloat(unitPrice);
    return {
      rowNo: i.rowNo,
      productId: i.productId ?? null,
      productCode: i.productCode ?? null,
      description: i.description ?? null,
      qty: i.qty ?? "1",
      uom: i.uom ?? null,
      unitPrice,
      currency: i.productCode ? (currencyMap[i.productCode] ?? null) : null,
      totalPrice: (qty * price).toFixed(2),
      imageKey: i.productCode ? (imageMap[i.productCode] ?? null) : null,
    };
  });

  return { items, orderedProductCodes, orderedSupplierIds };
}

export type PurchaseOrderCustomerPoRow = typeof purchaseOrderCustomerPo.$inferSelect;
export type GoodsReceiptSummary = { id: string; grNo: string; receivedDate: Date; createdAt: Date };
export type PurchaseOrderWithItems = PurchaseOrderRow & {
  items: PurchaseOrderItemEnriched[];
  createdByName: string | null;
  salesOrderNo: string | null;
  customerPos: PurchaseOrderCustomerPoRow[];
  goodsReceipts: GoodsReceiptSummary[];
};
export type PurchaseOrderListRow = PurchaseOrderRow & { createdByName: string | null; customerPoNos: string[] };

const EDITABLE_STATUSES = new Set(["draft"]);
const DELETABLE_STATUSES = new Set(["draft", "cancelled"]);

// ── Queries ────────────────────────────────────────────────────────────────

export type PendingPrRow = {
  id: string;
  prNo: string;
  status: string;
  salesOrderNo: string | null;
  customerPoNos: string[];
  requestedByName: string | null;
  itemCount: number;
  createdAt: Date;
};

export async function getPendingPrsForPoConversion(): Promise<PendingPrRow[]> {
  const { orgId } = await requireAccess("purchase-order:read");

  const rows = await db
    .select()
    .from(purchaseRequisition)
    .where(
      and(
        eq(purchaseRequisition.organizationId, orgId),
        inArray(purchaseRequisition.status, ["approved", "partially_ordered"]),
      ),
    )
    .orderBy(desc(purchaseRequisition.createdAt));

  if (rows.length === 0) return [];

  const userIds = [...new Set(rows.map((r) => r.requestedBy))];
  const users = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds));
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? null;

  const prIds = rows.map((r) => r.id);
  const items = await db
    .select({
      purchaseRequisitionId: purchaseRequisitionItem.purchaseRequisitionId,
      cpoNo: purchaseRequisitionItem.cpoNo,
    })
    .from(purchaseRequisitionItem)
    .where(inArray(purchaseRequisitionItem.purchaseRequisitionId, prIds));

  const countMap = new Map<string, number>();
  const cpoMap = new Map<string, Set<string>>();
  for (const i of items) {
    countMap.set(i.purchaseRequisitionId, (countMap.get(i.purchaseRequisitionId) ?? 0) + 1);
    if (i.cpoNo) {
      const set = cpoMap.get(i.purchaseRequisitionId) ?? new Set();
      set.add(i.cpoNo);
      cpoMap.set(i.purchaseRequisitionId, set);
    }
  }

  return rows.map((r) => {
    // Collect from items; fall back to the PR-level customerPoNo for old records
    const fromItems = [...(cpoMap.get(r.id) ?? [])];
    const customerPoNos = fromItems.length > 0
      ? fromItems
      : r.customerPoNo ? [r.customerPoNo] : [];
    return {
      id: r.id,
      prNo: r.prNo,
      status: r.status,
      salesOrderNo: r.salesOrderNo ?? null,
      customerPoNos,
      requestedByName: nameOf(r.requestedBy),
      itemCount: countMap.get(r.id) ?? 0,
      createdAt: r.createdAt,
    };
  });
}

export async function getPurchaseOrders(): Promise<PurchaseOrderListRow[]> {
  const { orgId } = await requireAccess("purchase-order:read");

  const rows = await db
    .select()
    .from(purchaseOrder)
    .where(eq(purchaseOrder.organizationId, orgId))
    .orderBy(desc(purchaseOrder.createdAt));

  if (rows.length === 0) return [];

  const poIds = rows.map((r) => r.id);
  const [users, cpoLinks] = await Promise.all([
    db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, [...new Set(rows.map((r) => r.createdBy))])),
    db.select({ purchaseOrderId: purchaseOrderCustomerPo.purchaseOrderId, customerPoNo: purchaseOrderCustomerPo.customerPoNo })
      .from(purchaseOrderCustomerPo)
      .where(inArray(purchaseOrderCustomerPo.purchaseOrderId, poIds)),
  ]);

  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? null;
  const cpoMap = new Map<string, string[]>();
  for (const link of cpoLinks) {
    const arr = cpoMap.get(link.purchaseOrderId) ?? [];
    arr.push(link.customerPoNo);
    cpoMap.set(link.purchaseOrderId, arr);
  }

  return rows.map((r) => ({ ...r, createdByName: nameOf(r.createdBy), customerPoNos: cpoMap.get(r.id) ?? [] }));
}

export async function getPurchaseOrderDetail(id: string): Promise<PurchaseOrderWithItems | null> {
  const { orgId } = await requireAccess("purchase-order:read");

  const [po] = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.organizationId, orgId)));

  if (!po) return null;

  const [items, users, customerPos, soRows, grs] = await Promise.all([
    db.select().from(purchaseOrderItem).where(eq(purchaseOrderItem.purchaseOrderId, id)).orderBy(asc(purchaseOrderItem.rowNo)),
    db.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, po.createdBy)),
    db.select().from(purchaseOrderCustomerPo).where(eq(purchaseOrderCustomerPo.purchaseOrderId, id)),
    po.salesOrderId
      ? db.select({ id: salesOrder.id, soNo: salesOrder.soNo }).from(salesOrder).where(eq(salesOrder.id, po.salesOrderId))
      : Promise.resolve([]),
    db.select({ id: goodsReceipt.id, grNo: goodsReceipt.grNo, receivedDate: goodsReceipt.receivedDate, createdAt: goodsReceipt.createdAt })
      .from(goodsReceipt)
      .where(eq(goodsReceipt.purchaseOrderId, id))
      .orderBy(desc(goodsReceipt.createdAt)),
  ]);

  const enrichedItems: PurchaseOrderItemEnriched[] = await Promise.all(
    items.map(async (i) => {
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

  return {
    ...po,
    items: enrichedItems,
    createdByName: users[0]?.name ?? null,
    salesOrderNo: soRows[0]?.soNo ?? null,
    customerPos,
    goodsReceipts: grs,
  };
}

export async function getPoForPrint(id: string) {
  const { orgId } = await requireAccess("purchase-order:read");

  const [po] = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.organizationId, orgId)));

  if (!po) return null;

  const [items, userRows, orgRows, soRows] = await Promise.all([
    db.select().from(purchaseOrderItem).where(eq(purchaseOrderItem.purchaseOrderId, id)).orderBy(asc(purchaseOrderItem.rowNo)),
    db.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, po.createdBy)),
    db.select({
      name: organization.name,
      logo: organization.logo,
      logoKey: organizationProfile.logoKey,
      brandColor: organizationProfile.brandColor,
      companyName: organizationProfile.companyName,
      companyAddress: organizationProfile.companyAddress,
      taxNo: organizationProfile.taxNo,
      phone: organizationProfile.phone,
      email: organizationProfile.email,
      website: organizationProfile.website,
      oldSsmNo: organizationProfile.oldSsmNo,
      newSsmNo: organizationProfile.newSsmNo,
      mdaEstablishmentNo: organizationProfile.mdaEstablishmentNo,
      bankingInfo: organizationProfile.bankingInfo,
      pdfTemplate: organizationProfile.pdfTemplate,
      headerLayout: organizationProfile.headerLayout,
      tableRowStyle: organizationProfile.tableRowStyle,
      tableFontSize: organizationProfile.tableFontSize,
      orgNameSize: organizationProfile.orgNameSize,
    })
    .from(organization)
    .leftJoin(organizationProfile, eq(organizationProfile.organizationId, organization.id))
    .where(eq(organization.id, orgId))
    .limit(1),
    po.salesOrderId
      ? db.select({ id: salesOrder.id, soNo: salesOrder.soNo }).from(salesOrder).where(eq(salesOrder.id, po.salesOrderId))
      : Promise.resolve([]),
  ]);

  const r2Public = process.env.R2_PUBLIC_URL ?? "";
  const org = orgRows[0];
  const orgLogoUrl = org?.logoKey ? `${r2Public}/${org.logoKey}` : (org?.logo ?? null);

  return {
    order: po,
    items,
    createdByName: userRows[0]?.name ?? null,
    salesOrderNo: soRows[0]?.soNo ?? null,
    orgName: org?.name ?? "",
    orgLogoUrl,
    orgBrandColor: org?.brandColor ?? null,
    orgCompanyName: org?.companyName ?? null,
    orgCompanyAddress: org?.companyAddress ?? null,
    orgTaxNo: org?.taxNo ?? null,
    orgPhone: org?.phone ?? null,
    orgEmail: org?.email ?? null,
    orgWebsite: org?.website ?? null,
    orgOldSsmNo: org?.oldSsmNo ?? null,
    orgNewSsmNo: org?.newSsmNo ?? null,
    orgMdaEstablishmentNo: org?.mdaEstablishmentNo ?? null,
    orgBankingInfo: (org?.bankingInfo ?? []) as any[],
    orgPdfTemplate:  org?.pdfTemplate  ?? "affirma",
    orgHeaderLayout: org?.headerLayout ?? "standard",
    orgTableRowStyle: org?.tableRowStyle ?? "default",
    orgTableFontSize: org?.tableFontSize ?? "normal",
    orgNameSize: org?.orgNameSize ?? "medium",
  };
}

// ── Mutations ──────────────────────────────────────────────────────────────

export async function getExistingDraftPo(): Promise<{ id: string; docNo: string } | null> {
  const { orgId } = await requireAccess("purchase-order:read");
  const [row] = await db
    .select({ id: purchaseOrder.id, prNo: purchaseOrder.prNo, poNo: purchaseOrder.poNo })
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.organizationId, orgId), eq(purchaseOrder.status, "draft")))
    .limit(1);
  if (!row) return null;
  return { id: row.id, docNo: row.prNo ?? row.poNo ?? row.id };
}

export async function createPurchaseOrder(input: CreatePurchaseOrderInput): Promise<PurchaseOrderRow> {
  const { orgId, userId } = await requireAccess("purchase-order:create");

  if (!input.supplierId) throw new Error("Supplier is required");

  const [sup] = await db.select().from(supplier).where(eq(supplier.id, input.supplierId));
  const supplierSnapshot: PurchaseOrderRow["supplierSnapshot"] = sup ? {
    name: sup.name,
    registrationNo: sup.registrationNo ?? undefined,
    address: sup.address ?? undefined,
    contactPerson: sup.contactPerson ?? undefined,
    contactNo: sup.contactNo ?? undefined,
    email: sup.email ?? undefined,
  } : null;

  const fromPr = !!input.purchaseRequisitionId;

  // All POs get a PO number and are created as confirmed — no draft/approval cycle here
  const prNo = null;
  const poNo = await generatePoNo(orgId);
  const status = "confirmed";

  const [row] = await db
    .insert(purchaseOrder)
    .values({
      id: nanoid(),
      organizationId: orgId,
      purchaseRequisitionId: input.purchaseRequisitionId ?? null,
      prNo,
      poNo,
      salesOrderId: input.salesOrderId ?? null,
      supplierId: input.supplierId,
      supplierSnapshot: supplierSnapshot ?? null,
      supplierQuotationKey: input.supplierQuotationKey ?? null,
      currency: input.currency ?? "MYR",
      subtotal: input.subtotal ?? "0",
      sst: input.sst ?? "0",
      sstPct: input.sstPct ?? "0",
      grandTotal: input.grandTotal ?? "0",
      notes: input.notes ?? null,
      expectedDeliveryDate: input.expectedDeliveryDate ?? null,
      deliveryAddress: input.deliveryAddress ?? null,
      status,
      createdBy: userId,
      ...(fromPr ? { approvedBy: userId, approvedAt: new Date() } : {}),
    })
    .returning();

  if (input.items.length > 0) {
    await db.insert(purchaseOrderItem).values(
      input.items.map((item) => ({
        id: nanoid(),
        purchaseOrderId: row.id,
        rowNo: item.rowNo,
        productId: item.productId ?? null,
        productCode: item.productCode ?? null,
        description: item.description ?? null,
        qty: item.qty ?? "1",
        uom: item.uom ?? null,
        unitPrice: item.unitPrice ?? "0",
        currency: item.currency ?? "MYR",
        totalPrice: item.totalPrice ?? "0",
        imageKey: item.imageKey ?? null,
        customerName: item.customerName ?? null,
        customerOrganization: item.customerOrganization ?? null,
        customerPoNo: item.customerPoNo ?? null,
      })),
    );
  }

  if (input.customerPoIds && input.customerPoIds.length > 0) {
    const cpoRows = await db
      .select({ id: customerPurchaseOrder.id, customerPoNo: customerPurchaseOrder.customerPoNo })
      .from(customerPurchaseOrder)
      .where(inArray(customerPurchaseOrder.id, input.customerPoIds));
    if (cpoRows.length > 0) {
      await db.insert(purchaseOrderCustomerPo).values(
        cpoRows.map((cpo) => ({
          id: nanoid(),
          purchaseOrderId: row.id,
          customerPoId: cpo.id,
          customerPoNo: cpo.customerPoNo,
        })),
      );
    }
  }

  // When converting from a PR, link PR items to this PO (match by productCode)
  // and update the PR's status to reflect ordering progress
  if (fromPr && poNo) {
    const poProductCodes = new Set(input.items.map((i) => i.productCode).filter(Boolean));

    const prItemsFull = await db
      .select({
        id: purchaseRequisitionItem.id,
        productCode: purchaseRequisitionItem.productCode,
        purchaseOrderId: purchaseRequisitionItem.purchaseOrderId,
      })
      .from(purchaseRequisitionItem)
      .where(eq(purchaseRequisitionItem.purchaseRequisitionId, input.purchaseRequisitionId!));

    // Link PR items whose productCode appears in this PO and aren't already linked to another PO
    const unlinked = prItemsFull.filter(
      (pi) => pi.productCode && poProductCodes.has(pi.productCode) && !pi.purchaseOrderId,
    );

    if (unlinked.length > 0) {
      await Promise.all(
        unlinked.map((pi) =>
          db.update(purchaseRequisitionItem)
            .set({ purchaseOrderId: row.id, purchaseOrderNo: poNo })
            .where(eq(purchaseRequisitionItem.id, pi.id)),
        ),
      );
    }

    // Re-check coverage after linking and update PR status
    const updatedItems = prItemsFull.map((pi) =>
      unlinked.find((u) => u.id === pi.id) ? { ...pi, purchaseOrderId: row.id } : pi,
    );
    const allLinked = updatedItems.every((i) => !!i.purchaseOrderId);
    const anyLinked = updatedItems.some((i) => !!i.purchaseOrderId);
    const newPrStatus = allLinked ? "ordered" : anyLinked ? "partially_ordered" : "approved";

    await db.update(purchaseRequisition)
      .set({ status: newPrStatus })
      .where(eq(purchaseRequisition.id, input.purchaseRequisitionId!));

    revalidatePath(`/dashboard/procurement/requisition/${input.purchaseRequisitionId}`);
    revalidatePath("/dashboard/procurement/requisition");
  }

  return row;
}

export async function updatePurchaseOrder(input: UpdatePurchaseOrderInput): Promise<PurchaseOrderRow> {
  const { orgId, userId } = await requireAccess("purchase-order:update");

  const [existing] = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, input.id), eq(purchaseOrder.organizationId, orgId)));

  if (!existing) throw new Error("Purchase order not found");
  if (existing.createdBy !== userId) throw new Error("Only the creator can edit this purchase order");
  if (!EDITABLE_STATUSES.has(existing.status)) throw new Error("Only draft purchase orders can be edited");

  if (
    input.supplierQuotationKey !== undefined &&
    existing.supplierQuotationKey &&
    existing.supplierQuotationKey !== input.supplierQuotationKey
  ) {
    await deleteFile(SUPPLIER_QUOTATION_BUCKET, existing.supplierQuotationKey);
  }

  // Rebuild supplier snapshot if supplier changed
  let supplierSnapshot = existing.supplierSnapshot;
  if (input.supplierId && input.supplierId !== existing.supplierId) {
    const [sup] = await db.select().from(supplier).where(eq(supplier.id, input.supplierId));
    if (sup) {
      supplierSnapshot = {
        name: sup.name,
        registrationNo: sup.registrationNo ?? undefined,
        address: sup.address ?? undefined,
        contactPerson: sup.contactPerson ?? undefined,
        contactNo: sup.contactNo ?? undefined,
        email: sup.email ?? undefined,
      };
    }
  }

  const [row] = await db
    .update(purchaseOrder)
    .set({
      salesOrderId: input.salesOrderId ?? null,
      supplierId: input.supplierId,
      supplierSnapshot,
      supplierQuotationKey: input.supplierQuotationKey !== undefined
        ? input.supplierQuotationKey
        : existing.supplierQuotationKey,
      currency: input.currency ?? existing.currency,
      subtotal: input.subtotal ?? existing.subtotal,
      sst: input.sst ?? existing.sst,
      sstPct: input.sstPct ?? existing.sstPct,
      grandTotal: input.grandTotal ?? existing.grandTotal,
      notes: input.notes ?? null,
      expectedDeliveryDate: input.expectedDeliveryDate ?? null,
      deliveryAddress: input.deliveryAddress ?? null,
      status: input.status ?? existing.status,
    })
    .where(eq(purchaseOrder.id, input.id))
    .returning();

  // Replace items (clean up old image keys)
  const oldItems = await db
    .select({ imageKey: purchaseOrderItem.imageKey })
    .from(purchaseOrderItem)
    .where(eq(purchaseOrderItem.purchaseOrderId, input.id));

  const newImageKeys = new Set(input.items.map((i) => i.imageKey).filter(Boolean));
  for (const old of oldItems) {
    if (old.imageKey && !newImageKeys.has(old.imageKey)) {
      await deleteFile(PROCUREMENT_DOCS_BUCKET, old.imageKey);
    }
  }

  await db.delete(purchaseOrderItem).where(eq(purchaseOrderItem.purchaseOrderId, input.id));

  if (input.items.length > 0) {
    await db.insert(purchaseOrderItem).values(
      input.items.map((item) => ({
        id: nanoid(),
        purchaseOrderId: input.id,
        rowNo: item.rowNo,
        productId: item.productId ?? null,
        productCode: item.productCode ?? null,
        description: item.description ?? null,
        qty: item.qty ?? "1",
        uom: item.uom ?? null,
        unitPrice: item.unitPrice ?? "0",
        currency: item.currency ?? "MYR",
        totalPrice: item.totalPrice ?? "0",
        imageKey: item.imageKey ?? null,
        customerName: item.customerName ?? null,
        customerOrganization: item.customerOrganization ?? null,
        customerPoNo: item.customerPoNo ?? null,
      })),
    );
  }

  // Sync customer PO junction
  await db.delete(purchaseOrderCustomerPo).where(eq(purchaseOrderCustomerPo.purchaseOrderId, input.id));
  if (input.customerPoIds && input.customerPoIds.length > 0) {
    const cpoRows = await db
      .select({ id: customerPurchaseOrder.id, customerPoNo: customerPurchaseOrder.customerPoNo })
      .from(customerPurchaseOrder)
      .where(inArray(customerPurchaseOrder.id, input.customerPoIds));
    if (cpoRows.length > 0) {
      await db.insert(purchaseOrderCustomerPo).values(
        cpoRows.map((cpo) => ({
          id: nanoid(),
          purchaseOrderId: input.id,
          customerPoId: cpo.id,
          customerPoNo: cpo.customerPoNo,
        })),
      );
    }
  }

  return row;
}

export async function deletePurchaseOrder(id: string): Promise<void> {
  const { orgId, userId } = await requireAccess("purchase-order:delete");

  const [existing] = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.organizationId, orgId)));

  if (!existing) throw new Error("Purchase order not found");
  if (existing.createdBy !== userId) throw new Error("Only the creator can delete this purchase order");
  if (existing.approvedAt) throw new Error("Approved purchase orders cannot be deleted");
  if (!DELETABLE_STATUSES.has(existing.status)) throw new Error("Only draft or cancelled purchase orders can be deleted");

  if (existing.supplierQuotationKey) {
    await deleteFile(SUPPLIER_QUOTATION_BUCKET, existing.supplierQuotationKey);
  }

  // Clean up item images
  const items = await db
    .select({ imageKey: purchaseOrderItem.imageKey })
    .from(purchaseOrderItem)
    .where(eq(purchaseOrderItem.purchaseOrderId, id));

  for (const item of items) {
    if (item.imageKey) await deleteFile(PROCUREMENT_DOCS_BUCKET, item.imageKey);
  }

  await db.delete(purchaseOrder).where(eq(purchaseOrder.id, id));
}

export async function updatePurchaseOrderStatus(id: string, status: string): Promise<void> {
  const { orgId } = await requireAccess("purchase-order:update");

  await db
    .update(purchaseOrder)
    .set({ status })
    .where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.organizationId, orgId)));
}

// ── Workflow actions ───────────────────────────────────────────────────────

async function getPoForWorkflow(id: string, orgId: string) {
  const [po] = await db
    .select({ id: purchaseOrder.id, prNo: purchaseOrder.prNo, poNo: purchaseOrder.poNo, status: purchaseOrder.status, createdBy: purchaseOrder.createdBy })
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.organizationId, orgId)));
  if (!po) throw new Error("Purchase order not found");
  return po;
}

export async function submitPurchaseOrder(id: string): Promise<void> {
  const { orgId, userId, session } = await requireAccess("purchase-order:update");
  const po = await getPoForWorkflow(id, orgId);
  if (po.status !== "draft") throw new Error("Only draft purchase orders can be submitted");
  await db.update(purchaseOrder).set({ status: "submitted" }).where(eq(purchaseOrder.id, id));

  revalidatePath(`/dashboard/procurement/purchase-order/${id}`);
  revalidatePath("/dashboard/procurement/purchase-order");

  const actorName = session.user.name;
  const docRef = po.prNo ?? po.poNo ?? id;
  getPoApprovers(orgId).then((approverIds) => {
    const targets = approverIds.filter((uid) => uid !== userId);
    if (targets.length === 0) return;
    Promise.all(
      targets.map((recipientId) =>
        createNotification({
          organizationId: orgId,
          userId: recipientId,
          type: "po:submitted",
          title: `PR ${docRef} pending approval`,
          body: `${actorName} submitted requisition ${docRef} for approval.`,
          link: `/dashboard/procurement/purchase-order/${po.id}`,
        }),
      ),
    );
  }).catch(console.error);
}

export async function approvePurchaseOrder(id: string): Promise<void> {
  const { orgId, userId, session } = await requireAccess("purchase-order:approve");
  const po = await getPoForWorkflow(id, orgId);
  if (po.status !== "submitted") throw new Error("Only submitted purchase orders can be approved");

  // Generate PO number at approval — this is when the PR becomes a Supplier PO
  const poNo = po.poNo ?? await generatePoNo(orgId);

  await db.update(purchaseOrder).set({ status: "confirmed", poNo, approvedBy: userId, approvedAt: new Date() }).where(eq(purchaseOrder.id, id));

  revalidatePath(`/dashboard/procurement/purchase-order/${id}`);
  revalidatePath("/dashboard/procurement/purchase-order");

  const docRef = po.prNo ?? poNo;
  createNotification({
    organizationId: orgId,
    userId: po.createdBy,
    type: "po:approved",
    title: `PR ${docRef} approved — PO ${poNo} issued`,
    body: `Your requisition ${docRef} was approved by ${session.user.name}. PO ${poNo} has been issued.`,
    link: `/dashboard/procurement/purchase-order/${po.id}`,
  }).catch(console.error);
}

export async function rejectPurchaseOrder(id: string): Promise<void> {
  const { orgId, session } = await requireAccess("purchase-order:approve");
  const po = await getPoForWorkflow(id, orgId);
  if (po.status !== "submitted") throw new Error("Only submitted purchase orders can be rejected");
  await db.update(purchaseOrder).set({ status: "draft" }).where(eq(purchaseOrder.id, id));

  revalidatePath(`/dashboard/procurement/purchase-order/${id}`);
  revalidatePath("/dashboard/procurement/purchase-order");

  const docRef = po.prNo ?? po.poNo ?? id;
  createNotification({
    organizationId: orgId,
    userId: po.createdBy,
    type: "po:rejected",
    title: `PR ${docRef} returned for revision`,
    body: `Your requisition ${docRef} was returned for revision by ${session.user.name}.`,
    link: `/dashboard/procurement/purchase-order/${po.id}`,
  }).catch(console.error);
}

export async function recallPurchaseOrder(id: string): Promise<void> {
  const { orgId, session } = await requireAccess("purchase-order:approve");
  const po = await getPoForWorkflow(id, orgId);
  if (po.status !== "confirmed") throw new Error("Only confirmed purchase orders can be recalled");
  await db.update(purchaseOrder).set({ status: "draft" }).where(eq(purchaseOrder.id, id));

  revalidatePath(`/dashboard/procurement/purchase-order/${id}`);
  revalidatePath("/dashboard/procurement/purchase-order");

  const docRef = po.poNo ?? po.prNo ?? id;
  createNotification({
    organizationId: orgId,
    userId: po.createdBy,
    type: "po:recalled",
    title: `PO ${docRef} recalled`,
    body: `Purchase order ${docRef} has been recalled by ${session.user.name}.`,
    link: `/dashboard/procurement/purchase-order/${po.id}`,
  }).catch(console.error);
}

export async function reconfirmPurchaseOrder(id: string): Promise<void> {
  const { orgId, session } = await requireAccess("purchase-order:approve");
  const po = await getPoForWorkflow(id, orgId);
  if (po.status !== "draft") throw new Error("Only draft purchase orders can be re-confirmed");
  await db.update(purchaseOrder).set({ status: "confirmed" }).where(eq(purchaseOrder.id, id));

  revalidatePath(`/dashboard/procurement/purchase-order/${id}`);
  revalidatePath("/dashboard/procurement/purchase-order");

  const docRef = po.poNo ?? po.prNo ?? id;
  createNotification({
    organizationId: orgId,
    userId: po.createdBy,
    type: "po:approved",
    title: `PO ${docRef} re-confirmed`,
    body: `Purchase order ${docRef} has been re-confirmed by ${session.user.name}.`,
    link: `/dashboard/procurement/purchase-order/${po.id}`,
  }).catch(console.error);
}

export async function fulfillPurchaseOrder(id: string, warehouseLabel = "Default"): Promise<void> {
  const { orgId, userId } = await requireAccess("purchase-order:update");
  const po = await getPoForWorkflow(id, orgId);
  if (po.status !== "confirmed") throw new Error("Purchase order must be confirmed (supplier PO) before marking as fulfilled");

  await db.update(purchaseOrder).set({ status: "fulfilled" }).where(eq(purchaseOrder.id, id));

  // Auto-create approved STOCK_IN for every item that has a linked productId
  const items = await db
    .select()
    .from(purchaseOrderItem)
    .where(eq(purchaseOrderItem.purchaseOrderId, id));

  await Promise.all(
    items
      .filter((item) => item.productId)
      .map(async (item) => {
        await createApprovedMovement({
          orgId,
          userId,
          productId: item.productId!,
          warehouseLabel,
          movementType: MOVEMENT_TYPE.STOCK_IN,
          quantity: parseFloat(item.qty ?? "1"),
          unitCost: item.unitPrice ?? undefined,
          referenceType: REF_TYPE.PURCHASE_ORDER,
          referenceId: id,
          referenceNo: po.poNo ?? po.prNo ?? id,
          notes: `PO receipt: ${item.productCode ?? ""}`.trim(),
        });
        // Write PO price back to product cost fields
        if (item.unitPrice) {
          await db
            .update(product)
            .set({
              costUnitPrice: item.unitPrice,
              ...(item.currency ? { costPriceCurrency: item.currency } : {}),
            })
            .where(eq(product.id, item.productId!));
        }
      }),
  );
}

export async function cancelPurchaseOrder(id: string): Promise<void> {
  const { orgId } = await requireAccess("purchase-order:update");
  const po = await getPoForWorkflow(id, orgId);
  if (po.status === "fulfilled" || po.status === "cancelled") throw new Error("Cannot cancel a fulfilled or already cancelled purchase order");
  await db.update(purchaseOrder).set({ status: "cancelled" }).where(eq(purchaseOrder.id, id));
}
