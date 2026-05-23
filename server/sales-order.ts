"use server";

import { db } from "@/db";
import {
  salesOrder,
  salesOrderItem,
  salesOrderCounter,
  customer,
  customerCompany,
  quotation,
  member,
  organization,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, desc, asc, inArray, sql } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getNumberingConfig } from "@/server/document-numbering";
import { buildDocumentNo } from "@/lib/document-numbering";
import { revalidatePath } from "next/cache";

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

export async function getSupplierQuotationUploadUrl(
  filename: string,
): Promise<{ key: string; uploadUrl: string }> {
  await requireAccess("sales-order:create");
  const key = `supplier-quotations/so/${nanoid()}-${filename}`;
  const cmd = new PutObjectCommand({
    Bucket: SUPPLIER_QUOTATION_BUCKET,
    Key: key,
    ContentType: "application/pdf",
  });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
  return { key, uploadUrl };
}

export async function getSupplierQuotationDownloadUrl(key: string): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: SUPPLIER_QUOTATION_BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: 3600 });
}

async function deleteSupplierQuotationFile(key: string | null | undefined) {
  if (!key) return;
  await s3.send(new DeleteObjectCommand({ Bucket: SUPPLIER_QUOTATION_BUCKET, Key: key }));
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

async function generateSoNo(orgId: string): Promise<string> {
  const cfg = await getNumberingConfig(orgId, "so");
  const year = new Date().getFullYear();

  const existing = await db
    .select()
    .from(salesOrderCounter)
    .where(eq(salesOrderCounter.organizationId, orgId))
    .limit(1);

  let nextNo: number;

  if (existing.length === 0) {
    await db.insert(salesOrderCounter).values({ id: nanoid(), organizationId: orgId, year, lastNumber: 1 });
    nextNo = 1;
  } else {
    const counter = existing[0];
    nextNo = counter.year === year ? counter.lastNumber + 1 : 1;
    await db
      .update(salesOrderCounter)
      .set({ year, lastNumber: nextNo })
      .where(eq(salesOrderCounter.organizationId, orgId));
  }

  return buildDocumentNo(cfg, year, nextNo);
}

// ── Types ──────────────────────────────────────────────────────────────────

export type SalesOrderRow = typeof salesOrder.$inferSelect;
export type SalesOrderItem = typeof salesOrderItem.$inferSelect;

export interface SalesOrderItemInput {
  rowNo: number;
  productId?: string;
  productCode?: string;
  description?: string;
  qty?: string;
  uom?: string;
  unitPrice?: string;
  discountPct?: string;
  discountAmt?: string;
  totalPrice?: string;
}

export interface CreateSalesOrderInput {
  customerId?: string;
  customerCompanyId?: string;
  quotationId?: string;
  quotationNo?: string;
  linkedQuotations?: { id: string; quotationNo: string }[];
  salesPersonId?: string;
  salesPersonName?: string;
  associateSalesPersons?: { id: string; name: string }[];
  subtotal?: string;
  overallDiscountPct?: string;
  overallDiscountAmt?: string;
  sst?: string;
  sstPct?: string;
  grandTotal?: string;
  notes?: string;
  deliveryDate?: Date;
  deliveryAddress?: string;
  supplierQuotationKey?: string;
  items: SalesOrderItemInput[];
}

export interface UpdateSalesOrderInput extends Omit<CreateSalesOrderInput, "items"> {
  id: string;
  status?: string;
  items: SalesOrderItemInput[];
}

export type SalesOrderWithItems = SalesOrderRow & { items: SalesOrderItem[] };

// ── Queries ────────────────────────────────────────────────────────────────

export async function getSalesOrders(): Promise<SalesOrderRow[]> {
  const { orgId, userId } = await requireAccess("sales-order:read");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  return db
    .select()
    .from(salesOrder)
    .where(eq(salesOrder.organizationId, ownerOrgId))
    .orderBy(desc(salesOrder.createdAt));
}

export async function getSalesOrderDetail(id: string): Promise<SalesOrderWithItems | null> {
  const { orgId, userId } = await requireAccess("sales-order:read");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  const [so] = await db
    .select()
    .from(salesOrder)
    .where(and(eq(salesOrder.id, id), eq(salesOrder.organizationId, ownerOrgId)));

  if (!so) return null;

  const items = await db
    .select()
    .from(salesOrderItem)
    .where(eq(salesOrderItem.salesOrderId, id))
    .orderBy(asc(salesOrderItem.rowNo));

  return { ...so, items };
}

// ── Mutations ──────────────────────────────────────────────────────────────

export async function createSalesOrder(input: CreateSalesOrderInput): Promise<SalesOrderRow> {
  const { orgId, userId, session } = await requireAccess("sales-order:create");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  // Build customer snapshot
  let customerSnapshot: SalesOrderRow["customerSnapshot"] = null;
  if (input.customerId) {
    const [cust] = await db
      .select()
      .from(customer)
      .where(eq(customer.id, input.customerId));

    if (cust) {
      let company: typeof customerCompany.$inferSelect | undefined;

      if (input.customerCompanyId) {
        const [c] = await db
          .select()
          .from(customerCompany)
          .where(eq(customerCompany.id, input.customerCompanyId));
        company = c;
      }

      if (!company) {
        const companies = await db
          .select()
          .from(customerCompany)
          .where(eq(customerCompany.customerId, cust.id))
          .orderBy(desc(customerCompany.isPrimary), asc(customerCompany.createdAt))
          .limit(1);
        company = companies[0];
      }

      customerSnapshot = {
        title: cust.title ?? undefined,
        name: cust.name,
        email: cust.email ?? undefined,
        contactNo: cust.contactNo ?? undefined,
        organizationName: company?.organizationName ?? undefined,
        organizationAddress: company?.organizationAddress ?? undefined,
        position: company?.position ?? undefined,
        department: company?.department ?? undefined,
      };
    }
  }

  const soNo = await generateSoNo(ownerOrgId);

  const [row] = await db
    .insert(salesOrder)
    .values({
      id: nanoid(),
      organizationId: ownerOrgId,
      soNo,
      quotationId: input.linkedQuotations?.[0]?.id ?? input.quotationId ?? null,
      quotationNo: input.linkedQuotations?.[0]?.quotationNo ?? input.quotationNo ?? null,
      linkedQuotations: input.linkedQuotations ?? null,
      customerId: input.customerId ?? null,
      customerSnapshot: customerSnapshot ?? null,
      supplierQuotationKey: input.supplierQuotationKey ?? null,
      salesPersonId: input.salesPersonId ?? null,
      salesPersonName: input.salesPersonName ?? null,
      associateSalesPersons: input.associateSalesPersons ?? null,
      subtotal: input.subtotal ?? "0",
      overallDiscountPct: input.overallDiscountPct ?? "0",
      overallDiscountAmt: input.overallDiscountAmt ?? "0",
      sst: input.sst ?? "0",
      sstPct: input.sstPct ?? "0",
      grandTotal: input.grandTotal ?? "0",
      notes: input.notes ?? null,
      deliveryDate: input.deliveryDate ?? null,
      deliveryAddress: input.deliveryAddress ?? null,
      status: "draft",
      createdBy: userId,
    })
    .returning();

  if (input.items.length > 0) {
    await db.insert(salesOrderItem).values(
      input.items.map((item) => ({
        id: nanoid(),
        salesOrderId: row.id,
        rowNo: item.rowNo,
        productId: item.productId ?? null,
        productCode: item.productCode ?? null,
        description: item.description ?? null,
        qty: item.qty ?? "1",
        uom: item.uom ?? null,
        unitPrice: item.unitPrice ?? "0",
        discountPct: item.discountPct ?? "0",
        discountAmt: item.discountAmt ?? "0",
        totalPrice: item.totalPrice ?? "0",
      })),
    );
  }

  revalidatePath("/dashboard/sales/order");
  return row;
}

export async function updateSalesOrder(input: UpdateSalesOrderInput): Promise<SalesOrderRow> {
  const { orgId, userId } = await requireAccess("sales-order:update");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  const [existing] = await db
    .select()
    .from(salesOrder)
    .where(and(eq(salesOrder.id, input.id), eq(salesOrder.organizationId, ownerOrgId)));

  if (!existing) throw new Error("Sales order not found");

  // Delete old R2 file if key changed
  if (
    input.supplierQuotationKey !== undefined &&
    existing.supplierQuotationKey &&
    existing.supplierQuotationKey !== input.supplierQuotationKey
  ) {
    await deleteSupplierQuotationFile(existing.supplierQuotationKey);
  }

  // Rebuild customer snapshot if customer changed
  let customerSnapshot: SalesOrderRow["customerSnapshot"] = existing.customerSnapshot;
  if (input.customerId !== undefined) {
    if (!input.customerId) {
      customerSnapshot = null;
    } else {
      const [cust] = await db.select().from(customer).where(eq(customer.id, input.customerId));
      if (cust) {
        let company: typeof customerCompany.$inferSelect | undefined;
        if (input.customerCompanyId) {
          const [c] = await db.select().from(customerCompany).where(eq(customerCompany.id, input.customerCompanyId));
          company = c;
        }
        if (!company) {
          const companies = await db
            .select()
            .from(customerCompany)
            .where(eq(customerCompany.customerId, cust.id))
            .orderBy(desc(customerCompany.isPrimary), asc(customerCompany.createdAt))
            .limit(1);
          company = companies[0];
        }
        customerSnapshot = {
          title: cust.title ?? undefined,
          name: cust.name,
          email: cust.email ?? undefined,
          contactNo: cust.contactNo ?? undefined,
          organizationName: company?.organizationName ?? undefined,
          organizationAddress: company?.organizationAddress ?? undefined,
          position: company?.position ?? undefined,
          department: company?.department ?? undefined,
        };
      }
    }
  }

  const [row] = await db
    .update(salesOrder)
    .set({
      customerId: input.customerId ?? existing.customerId,
      customerSnapshot,
      quotationId: input.linkedQuotations !== undefined
        ? (input.linkedQuotations[0]?.id ?? null)
        : (input.quotationId !== undefined ? (input.quotationId ?? null) : existing.quotationId),
      quotationNo: input.linkedQuotations !== undefined
        ? (input.linkedQuotations[0]?.quotationNo ?? null)
        : (input.quotationNo !== undefined ? (input.quotationNo ?? null) : existing.quotationNo),
      linkedQuotations: input.linkedQuotations !== undefined ? (input.linkedQuotations ?? null) : existing.linkedQuotations,
      supplierQuotationKey: input.supplierQuotationKey !== undefined
        ? input.supplierQuotationKey
        : existing.supplierQuotationKey,
      salesPersonId: input.salesPersonId ?? null,
      salesPersonName: input.salesPersonName ?? null,
      associateSalesPersons: input.associateSalesPersons !== undefined ? (input.associateSalesPersons ?? null) : existing.associateSalesPersons,
      subtotal: input.subtotal ?? existing.subtotal,
      overallDiscountPct: input.overallDiscountPct ?? existing.overallDiscountPct,
      overallDiscountAmt: input.overallDiscountAmt ?? existing.overallDiscountAmt,
      sst: input.sst ?? existing.sst,
      sstPct: input.sstPct ?? existing.sstPct,
      grandTotal: input.grandTotal ?? existing.grandTotal,
      notes: input.notes !== undefined ? (input.notes ?? null) : existing.notes,
      deliveryDate: input.deliveryDate !== undefined ? (input.deliveryDate ?? null) : existing.deliveryDate,
      deliveryAddress: input.deliveryAddress !== undefined ? (input.deliveryAddress ?? null) : existing.deliveryAddress,
      status: input.status ?? existing.status,
    })
    .where(eq(salesOrder.id, input.id))
    .returning();

  // Replace items
  await db.delete(salesOrderItem).where(eq(salesOrderItem.salesOrderId, input.id));

  if (input.items.length > 0) {
    await db.insert(salesOrderItem).values(
      input.items.map((item) => ({
        id: nanoid(),
        salesOrderId: input.id,
        rowNo: item.rowNo,
        productId: item.productId ?? null,
        productCode: item.productCode ?? null,
        description: item.description ?? null,
        qty: item.qty ?? "1",
        uom: item.uom ?? null,
        unitPrice: item.unitPrice ?? "0",
        discountPct: item.discountPct ?? "0",
        discountAmt: item.discountAmt ?? "0",
        totalPrice: item.totalPrice ?? "0",
      })),
    );
  }

  revalidatePath("/dashboard/sales/order");
  return row;
}

export async function deleteSalesOrder(id: string): Promise<void> {
  const { orgId, userId } = await requireAccess("sales-order:delete");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  const [existing] = await db
    .select()
    .from(salesOrder)
    .where(and(eq(salesOrder.id, id), eq(salesOrder.organizationId, ownerOrgId)));

  if (existing?.supplierQuotationKey) {
    await deleteSupplierQuotationFile(existing.supplierQuotationKey);
  }

  await db.delete(salesOrder).where(eq(salesOrder.id, id));
  revalidatePath("/dashboard/sales/order");
}

export async function updateSalesOrderStatus(id: string, status: string): Promise<void> {
  const { orgId, userId } = await requireAccess("sales-order:update");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  await db
    .update(salesOrder)
    .set({ status })
    .where(and(eq(salesOrder.id, id), eq(salesOrder.organizationId, ownerOrgId)));
}
