"use server";

import { db } from "@/db";
import {
  purchaseOrder,
  purchaseOrderItem,
  purchaseOrderCounter,
  supplier,
  member,
  organization,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, desc, asc } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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

async function getOwnerOrgId(userId: string, currentOrgId: string): Promise<string> {
  const [ownerMember] = await db
    .select()
    .from(member)
    .where(and(eq(member.organizationId, currentOrgId), eq(member.role, "owner")))
    .limit(1);

  if (!ownerMember) return currentOrgId;

  const [primaryOrg] = await db
    .select()
    .from(member)
    .where(and(eq(member.userId, ownerMember.userId), eq(member.role, "owner")))
    .orderBy(asc(member.createdAt))
    .limit(1);

  return primaryOrg?.organizationId ?? currentOrgId;
}

// ── Running number ─────────────────────────────────────────────────────────

async function generatePoNo(orgId: string): Promise<string> {
  const [org] = await db
    .select({ slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, orgId));

  const prefix = (org?.slug ?? "ORG").toUpperCase();
  const year = new Date().getFullYear();

  const existing = await db
    .select()
    .from(purchaseOrderCounter)
    .where(eq(purchaseOrderCounter.organizationId, orgId))
    .limit(1);

  let nextNo: number;

  if (existing.length === 0) {
    await db.insert(purchaseOrderCounter).values({
      id: nanoid(),
      organizationId: orgId,
      year,
      lastNumber: 1,
    });
    nextNo = 1;
  } else {
    const counter = existing[0];
    nextNo = counter.year === year ? counter.lastNumber + 1 : 1;
    await db
      .update(purchaseOrderCounter)
      .set({ year, lastNumber: nextNo })
      .where(eq(purchaseOrderCounter.organizationId, orgId));
  }

  return `${prefix}-PO-${year}-${String(nextNo).padStart(4, "0")}`;
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
  salesOrderId?: string;
  supplierId?: string;
  supplierQuotationKey?: string;
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

export type PurchaseOrderWithItems = PurchaseOrderRow & { items: PurchaseOrderItem[] };

// ── Queries ────────────────────────────────────────────────────────────────

export async function getPurchaseOrders(): Promise<PurchaseOrderRow[]> {
  const { orgId, userId } = await requireAccess("purchase-order:read");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  return db
    .select()
    .from(purchaseOrder)
    .where(eq(purchaseOrder.organizationId, ownerOrgId))
    .orderBy(desc(purchaseOrder.createdAt));
}

export async function getPurchaseOrderDetail(id: string): Promise<PurchaseOrderWithItems | null> {
  const { orgId, userId } = await requireAccess("purchase-order:read");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  const [po] = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.organizationId, ownerOrgId)));

  if (!po) return null;

  const items = await db
    .select()
    .from(purchaseOrderItem)
    .where(eq(purchaseOrderItem.purchaseOrderId, id))
    .orderBy(asc(purchaseOrderItem.rowNo));

  return { ...po, items };
}

// ── Mutations ──────────────────────────────────────────────────────────────

export async function createPurchaseOrder(input: CreatePurchaseOrderInput): Promise<PurchaseOrderRow> {
  const { orgId, userId } = await requireAccess("purchase-order:create");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  // Build supplier snapshot
  let supplierSnapshot: PurchaseOrderRow["supplierSnapshot"] = null;
  if (input.supplierId) {
    const [sup] = await db
      .select()
      .from(supplier)
      .where(eq(supplier.id, input.supplierId));

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

  const poNo = await generatePoNo(ownerOrgId);

  const [row] = await db
    .insert(purchaseOrder)
    .values({
      id: nanoid(),
      organizationId: ownerOrgId,
      poNo,
      salesOrderId: input.salesOrderId ?? null,
      supplierId: input.supplierId ?? null,
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

  return row;
}

export async function updatePurchaseOrder(input: UpdatePurchaseOrderInput): Promise<PurchaseOrderRow> {
  const { orgId, userId } = await requireAccess("purchase-order:update");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  const [existing] = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, input.id), eq(purchaseOrder.organizationId, ownerOrgId)));

  if (!existing) throw new Error("Purchase order not found");

  if (
    input.supplierQuotationKey !== undefined &&
    existing.supplierQuotationKey &&
    existing.supplierQuotationKey !== input.supplierQuotationKey
  ) {
    await deleteFile(SUPPLIER_QUOTATION_BUCKET, existing.supplierQuotationKey);
  }

  const [row] = await db
    .update(purchaseOrder)
    .set({
      supplierId: input.supplierId ?? null,
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

  return row;
}

export async function deletePurchaseOrder(id: string): Promise<void> {
  const { orgId, userId } = await requireAccess("purchase-order:delete");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  const [existing] = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.organizationId, ownerOrgId)));

  if (!existing) return;

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
  const { orgId, userId } = await requireAccess("purchase-order:update");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  await db
    .update(purchaseOrder)
    .set({ status })
    .where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.organizationId, ownerOrgId)));
}
