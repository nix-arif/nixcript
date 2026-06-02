"use server";

import { db } from "@/db";
import {
  purchaseOrder,
  purchaseOrderItem,
  purchaseOrderCounter,
  purchaseOrderCustomerPo,
  customerPurchaseOrder,
  salesOrder,
  salesOrderItem,
  product,
  supplier,
  user,
  organization,
  organizationProfile,
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
import { createApprovedMovement } from "@/lib/inventory/create-movement";
import { MOVEMENT_TYPE, REF_TYPE } from "@/lib/inventory/constants";

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

// ── R2 product image (purchase order item) ─────────────────────────────────
const PRODUCT_IMAGE_BUCKET = process.env.R2_PRODUCT_IMAGE_BUCKET ?? process.env.R2_CERTIFICATES_BUCKET!;

export async function getPoItemImageUploadUrl(
  filename: string,
): Promise<{ key: string; uploadUrl: string }> {
  await requireAccess("purchase-order:create");
  const key = `po-product-images/${nanoid()}-${filename}`;
  const cmd = new PutObjectCommand({
    Bucket: PRODUCT_IMAGE_BUCKET,
    Key: key,
  });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
  return { key, uploadUrl };
}

export async function getPoItemImageDownloadUrl(key: string): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: PRODUCT_IMAGE_BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: 3600 });
}

async function deleteFile(bucket: string, key: string | null | undefined) {
  if (!key) return;
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

// ── Auth helpers ───────────────────────────────────────────────────────────

async function getSession() {
  const session = await getCachedSession();
  if (!session) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  return { session, orgId, userId: session.user.id };
}

async function requireAccess(permission: string) {
  const { session, orgId, userId } = await getSession();
  const perms = await getUserPermissions(userId, orgId);
  if (!hasAccess(perms, permission)) throw new Error("Forbidden");
  return { session, orgId, userId };
}


// ── Running number ─────────────────────────────────────────────────────────

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

export interface PurchaseOrderItemInput {
  rowNo: number;
  productId?: string;
  productCode?: string;
  description?: string;
  qty?: string;
  uom?: string;
  unitPrice?: string;
  totalPrice?: string;
  imageKey?: string;
}

export interface CreatePurchaseOrderInput {
  salesOrderId: string;
  supplierId: string;
  supplierQuotationKey?: string;
  customerPoIds?: string[];
  sst?: string;
  sstPct?: string;
  subtotal?: string;
  grandTotal?: string;
  notes?: string;
  expectedDeliveryDate?: Date;
  deliveryAddress?: string;
  items: PurchaseOrderItemInput[];
}

export interface UpdatePurchaseOrderInput extends Omit<CreatePurchaseOrderInput, "items"> {
  id: string;
  status?: string;
  items: PurchaseOrderItemInput[];
}

// ── Reference data fetchers for PO forms ──────────────────────────────────

export async function getApprovedSalesOrders(): Promise<{ id: string; soNo: string; customerName: string | null }[]> {
  const { orgId } = await requireAccess("purchase-order:read");

  // Exclude SOs that already have an active (non-cancelled) PO
  const linkedSoIds = (
    await db
      .select({ salesOrderId: purchaseOrder.salesOrderId })
      .from(purchaseOrder)
      .where(
        and(
          eq(purchaseOrder.organizationId, orgId),
          sql`${purchaseOrder.salesOrderId} is not null`,
          sql`${purchaseOrder.status} != 'cancelled'`,
        ),
      )
  )
    .map((r) => r.salesOrderId)
    .filter((id): id is string => !!id);

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
        linkedSoIds.length > 0 ? notInArray(salesOrder.id, linkedSoIds) : undefined,
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

export interface SoItemForPo {
  rowNo: number;
  productId: string | null;
  productCode: string | null;
  description: string | null;
  qty: string;
  uom: string | null;
  unitPrice: string | null;
  totalPrice: string | null;
  imageKey: string | null;
}

export async function getSalesOrderItemsForPo(soId: string): Promise<SoItemForPo[]> {
  await requireAccess("purchase-order:read");
  const items = await db
    .select()
    .from(salesOrderItem)
    .where(eq(salesOrderItem.salesOrderId, soId))
    .orderBy(asc(salesOrderItem.rowNo));

  if (items.length === 0) return [];

  const codes = items.map((i) => i.productCode).filter((c): c is string => !!c);
  const imageMap: Record<string, string | null> = {};
  const costMap: Record<string, string | null> = {};

  if (codes.length > 0) {
    const prods = await db
      .select({ productCode: product.productCode, imageKey: product.imageKey, costUnitPrice: product.costUnitPrice })
      .from(product)
      .where(inArray(product.productCode, codes));
    for (const p of prods) {
      imageMap[p.productCode] = p.imageKey ?? null;
      costMap[p.productCode] = p.costUnitPrice ?? null;
    }
  }

  return items.map((i) => {
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
      totalPrice: (qty * price).toFixed(2),
      imageKey: i.productCode ? (imageMap[i.productCode] ?? null) : null,
    };
  });
}

export type PurchaseOrderCustomerPoRow = typeof purchaseOrderCustomerPo.$inferSelect;
export type PurchaseOrderWithItems = PurchaseOrderRow & {
  items: PurchaseOrderItem[];
  createdByName: string | null;
  salesOrderNo: string | null;
  customerPos: PurchaseOrderCustomerPoRow[];
};
export type PurchaseOrderListRow = PurchaseOrderRow & { createdByName: string | null };

const EDITABLE_STATUSES = new Set(["draft"]);
const DELETABLE_STATUSES = new Set(["draft", "cancelled"]);

// ── Queries ────────────────────────────────────────────────────────────────

export async function getPurchaseOrders(): Promise<PurchaseOrderListRow[]> {
  const { orgId } = await requireAccess("purchase-order:read");

  const rows = await db
    .select()
    .from(purchaseOrder)
    .where(eq(purchaseOrder.organizationId, orgId))
    .orderBy(desc(purchaseOrder.createdAt));

  if (rows.length === 0) return [];

  const creatorIds = [...new Set(rows.map((r) => r.createdBy))];
  const users = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, creatorIds));
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? null;

  return rows.map((r) => ({ ...r, createdByName: nameOf(r.createdBy) }));
}

export async function getPurchaseOrderDetail(id: string): Promise<PurchaseOrderWithItems | null> {
  const { orgId } = await requireAccess("purchase-order:read");

  const [po] = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.organizationId, orgId)));

  if (!po) return null;

  const [items, users, customerPos, soRows] = await Promise.all([
    db.select().from(purchaseOrderItem).where(eq(purchaseOrderItem.purchaseOrderId, id)).orderBy(asc(purchaseOrderItem.rowNo)),
    db.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, po.createdBy)),
    db.select().from(purchaseOrderCustomerPo).where(eq(purchaseOrderCustomerPo.purchaseOrderId, id)),
    po.salesOrderId
      ? db.select({ id: salesOrder.id, soNo: salesOrder.soNo }).from(salesOrder).where(eq(salesOrder.id, po.salesOrderId))
      : Promise.resolve([]),
  ]);

  return {
    ...po,
    items,
    createdByName: users[0]?.name ?? null,
    salesOrderNo: soRows[0]?.soNo ?? null,
    customerPos,
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
  };
}

// ── Mutations ──────────────────────────────────────────────────────────────

export async function createPurchaseOrder(input: CreatePurchaseOrderInput): Promise<PurchaseOrderRow> {
  const { orgId, userId } = await requireAccess("purchase-order:create");

  if (!input.salesOrderId) throw new Error("A linked sales order is required");
  if (!input.supplierId) throw new Error("Supplier is required");

  // Build supplier snapshot
  let supplierSnapshot: PurchaseOrderRow["supplierSnapshot"] = null;
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

  const poNo = await generatePoNo(orgId);

  const [row] = await db
    .insert(purchaseOrder)
    .values({
      id: nanoid(),
      organizationId: orgId,
      poNo,
      salesOrderId: input.salesOrderId ?? null,
      supplierId: input.supplierId,
      supplierSnapshot: supplierSnapshot ?? null,
      supplierQuotationKey: input.supplierQuotationKey ?? null,
      subtotal: input.subtotal ?? "0",
      sst: input.sst ?? "0",
      sstPct: input.sstPct ?? "0",
      grandTotal: input.grandTotal ?? "0",
      notes: input.notes ?? null,
      expectedDeliveryDate: input.expectedDeliveryDate ?? null,
      deliveryAddress: input.deliveryAddress ?? null,
      status: "draft",
      createdBy: userId,
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
        totalPrice: item.totalPrice ?? "0",
        imageKey: item.imageKey ?? null,
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

  return row;
}

export async function updatePurchaseOrder(input: UpdatePurchaseOrderInput): Promise<PurchaseOrderRow> {
  const { orgId } = await requireAccess("purchase-order:update");

  const [existing] = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, input.id), eq(purchaseOrder.organizationId, orgId)));

  if (!existing) throw new Error("Purchase order not found");
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
      await deleteFile(PRODUCT_IMAGE_BUCKET, old.imageKey);
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
        totalPrice: item.totalPrice ?? "0",
        imageKey: item.imageKey ?? null,
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
  const { orgId } = await requireAccess("purchase-order:delete");

  const [existing] = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.organizationId, orgId)));

  if (!existing) throw new Error("Purchase order not found");
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
    if (item.imageKey) await deleteFile(PRODUCT_IMAGE_BUCKET, item.imageKey);
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
    .select({ id: purchaseOrder.id, poNo: purchaseOrder.poNo, status: purchaseOrder.status, createdBy: purchaseOrder.createdBy })
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.organizationId, orgId)));
  if (!po) throw new Error("Purchase order not found");
  return po;
}

export async function sendPurchaseOrder(id: string): Promise<void> {
  const { orgId } = await requireAccess("purchase-order:update");
  const po = await getPoForWorkflow(id, orgId);
  if (po.status !== "draft") throw new Error("Only draft purchase orders can be sent");
  await db.update(purchaseOrder).set({ status: "sent" }).where(eq(purchaseOrder.id, id));
}

export async function acknowledgePurchaseOrder(id: string): Promise<void> {
  const { orgId } = await requireAccess("purchase-order:update");
  const po = await getPoForWorkflow(id, orgId);
  if (po.status !== "sent") throw new Error("Only sent purchase orders can be acknowledged");
  await db.update(purchaseOrder).set({ status: "acknowledged" }).where(eq(purchaseOrder.id, id));
}

export async function receivePurchaseOrder(id: string, warehouseLabel = "Default"): Promise<void> {
  const { orgId, userId } = await requireAccess("purchase-order:update");
  const po = await getPoForWorkflow(id, orgId);
  if (po.status !== "acknowledged" && po.status !== "sent") throw new Error("Purchase order must be sent or acknowledged before receiving");

  await db.update(purchaseOrder).set({ status: "received" }).where(eq(purchaseOrder.id, id));

  // Auto-create approved STOCK_IN for every item that has a linked productId
  const items = await db
    .select()
    .from(purchaseOrderItem)
    .where(eq(purchaseOrderItem.purchaseOrderId, id));

  await Promise.all(
    items
      .filter((item) => item.productId)
      .map((item) =>
        createApprovedMovement({
          orgId,
          userId,
          productId: item.productId!,
          warehouseLabel,
          movementType: MOVEMENT_TYPE.STOCK_IN,
          quantity: parseFloat(item.qty ?? "1"),
          unitCost: item.unitPrice ?? undefined,
          referenceType: REF_TYPE.PURCHASE_ORDER,
          referenceId: id,
          referenceNo: po.poNo,
          notes: `PO receipt: ${item.productCode ?? ""}`.trim(),
        }),
      ),
  );
}

export async function cancelPurchaseOrder(id: string): Promise<void> {
  const { orgId } = await requireAccess("purchase-order:update");
  const po = await getPoForWorkflow(id, orgId);
  if (po.status === "received" || po.status === "cancelled") throw new Error("Cannot cancel a received or already cancelled purchase order");
  await db.update(purchaseOrder).set({ status: "cancelled" }).where(eq(purchaseOrder.id, id));
}
