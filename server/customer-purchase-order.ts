"use server";

import { db } from "@/db";
import {
  customerPurchaseOrder,
  customer,
  customerCompany,
  salesOrder,
  deliveryOrder,
  invoice,
  purchaseOrder,
  purchaseOrderCustomerPo,
  user,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, desc, asc, ilike, inArray, or } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
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
const BUCKET = process.env.R2_CUSTOMER_PURCHASE_ORDER_BUCKET!;

export async function getCustomerPoDocumentUploadUrl(
  filename: string,
  mimeType?: string,
): Promise<{ key: string; uploadUrl: string }> {
  await requireAccess("customer-po:create");
  const key = `customer-pos/${nanoid()}-${filename}`;
  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ...(mimeType ? { ContentType: mimeType } : {}),
  });
  return { key, uploadUrl: await getSignedUrl(s3, cmd, { expiresIn: 3600 }) };
}

export async function getCustomerPoDocumentDownloadUrl(key: string): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: 3600 });
}

async function deleteDocument(key: string | null | undefined) {
  if (!key) return;
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
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


export type CustomerPo = typeof customerPurchaseOrder.$inferSelect;

export interface CreateCustomerPoInput {
  customerPoNo: string;
  customerId?: string;
  customerCompanyId?: string;
  quotationId?: string;
  quotationNo?: string;
  salesOrderId?: string;
  salesOrderNo?: string;
  amount?: string;
  currency?: string;
  documentKey?: string;
  notes?: string;
  receivedDate?: Date;
  status?: string;
}

export interface UpdateCustomerPoInput extends CreateCustomerPoInput {
  id: string;
}

export async function getCustomerPos(): Promise<CustomerPo[]> {
  const { orgId } = await requireAccess("customer-po:read");
  return db
    .select()
    .from(customerPurchaseOrder)
    .where(eq(customerPurchaseOrder.organizationId, orgId))
    .orderBy(desc(customerPurchaseOrder.createdAt));
}

export async function getCustomerPoDetail(id: string): Promise<CustomerPo | null> {
  const { orgId } = await requireAccess("customer-po:read");
  const [row] = await db
    .select()
    .from(customerPurchaseOrder)
    .where(and(eq(customerPurchaseOrder.id, id), eq(customerPurchaseOrder.organizationId, orgId)));
  return row ?? null;
}

export async function getCustomerPosByCustomer(customerId: string): Promise<CustomerPo[]> {
  const { orgId } = await requireAccess("customer-po:read");
  return db
    .select()
    .from(customerPurchaseOrder)
    .where(
      and(
        eq(customerPurchaseOrder.organizationId, orgId),
        eq(customerPurchaseOrder.customerId, customerId),
      ),
    )
    .orderBy(desc(customerPurchaseOrder.createdAt));
}

export async function createCustomerPo(input: CreateCustomerPoInput): Promise<CustomerPo> {
  const { orgId, userId } = await requireAccess("customer-po:create");

  let customerSnapshot: CustomerPo["customerSnapshot"] = null;
  if (input.customerId) {
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
      };
    }
  }

  const [row] = await db
    .insert(customerPurchaseOrder)
    .values({
      id: nanoid(),
      organizationId: orgId,
      customerPoNo: input.customerPoNo,
      customerId: input.customerId ?? null,
      customerSnapshot,
      quotationId: input.quotationId ?? null,
      quotationNo: input.quotationNo ?? null,
      salesOrderId: input.salesOrderId ?? null,
      salesOrderNo: input.salesOrderNo ?? null,
      amount: input.amount ?? "0",
      currency: input.currency ?? "MYR",
      documentKey: input.documentKey ?? null,
      notes: input.notes ?? null,
      receivedDate: input.receivedDate ?? null,
      status: input.status ?? "received",
      createdBy: userId,
    })
    .returning();
  return row;
}

export async function updateCustomerPo(input: UpdateCustomerPoInput): Promise<CustomerPo> {
  const { orgId } = await requireAccess("customer-po:update");

  const [existing] = await db
    .select()
    .from(customerPurchaseOrder)
    .where(and(eq(customerPurchaseOrder.id, input.id), eq(customerPurchaseOrder.organizationId, orgId)));
  if (!existing) throw new Error("Customer PO not found");

  if (input.documentKey !== undefined && existing.documentKey && existing.documentKey !== input.documentKey) {
    await deleteDocument(existing.documentKey);
  }

  const [row] = await db
    .update(customerPurchaseOrder)
    .set({
      customerPoNo: input.customerPoNo,
      quotationId: input.quotationId ?? null,
      quotationNo: input.quotationNo ?? null,
      salesOrderId: input.salesOrderId ?? null,
      salesOrderNo: input.salesOrderNo ?? null,
      amount: input.amount ?? existing.amount,
      currency: input.currency ?? existing.currency,
      documentKey: input.documentKey !== undefined ? input.documentKey : existing.documentKey,
      notes: input.notes ?? null,
      receivedDate: input.receivedDate ?? null,
      status: input.status ?? existing.status,
    })
    .where(eq(customerPurchaseOrder.id, input.id))
    .returning();
  return row;
}

export interface CustomerPoTrackingData {
  cpo: CustomerPo;
  createdByName: string | null;
  so: {
    id: string; soNo: string; status: string;
    createdAt: Date; grandTotal: string | null;
    deliveryDate: Date | null;
  } | null;
  internalPos: { id: string; poNo: string; status: string; createdAt: Date; grandTotal: string | null }[];
  dos: { id: string; doNo: string; status: string; createdAt: Date; deliveryDate: Date | null }[];
  invoices: {
    id: string; invoiceNo: string; status: string; createdAt: Date;
    grandTotal: string; dueDate: Date | null; paidAt: Date | null; paidAmount: string | null;
    paymentTerms: string | null;
  }[];
}

export async function getCustomerPoForTracking(id: string): Promise<CustomerPoTrackingData | null> {
  const { orgId } = await requireAccess("customer-po:read");

  const [cpo] = await db
    .select()
    .from(customerPurchaseOrder)
    .where(and(eq(customerPurchaseOrder.id, id), eq(customerPurchaseOrder.organizationId, orgId)));

  if (!cpo) return null;

  const [userRows, soRows, poLinkRows] = await Promise.all([
    db.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, cpo.createdBy)),
    cpo.salesOrderId
      ? db.select({
          id: salesOrder.id, soNo: salesOrder.soNo, status: salesOrder.status,
          createdAt: salesOrder.createdAt, grandTotal: salesOrder.grandTotal,
          deliveryDate: salesOrder.deliveryDate,
        }).from(salesOrder).where(eq(salesOrder.id, cpo.salesOrderId))
      : Promise.resolve([]),
    db.select({ purchaseOrderId: purchaseOrderCustomerPo.purchaseOrderId })
      .from(purchaseOrderCustomerPo)
      .where(eq(purchaseOrderCustomerPo.customerPoId, id)),
  ]);

  const so = soRows[0] ?? null;

  const [dosRows, invoiceRows, internalPoRows] = await Promise.all([
    so
      ? db.select({
          id: deliveryOrder.id, doNo: deliveryOrder.doNo, status: deliveryOrder.status,
          createdAt: deliveryOrder.createdAt, deliveryDate: deliveryOrder.deliveryDate,
        }).from(deliveryOrder).where(eq(deliveryOrder.salesOrderId, so.id))
          .orderBy(asc(deliveryOrder.createdAt))
      : Promise.resolve([]),
    db.select({
      id: invoice.id, invoiceNo: invoice.invoiceNo, status: invoice.status,
      createdAt: invoice.createdAt, grandTotal: invoice.grandTotal,
      dueDate: invoice.dueDate, paidAt: invoice.paidAt, paidAmount: invoice.paidAmount,
      paymentTerms: invoice.paymentTerms,
    }).from(invoice)
      .where(
        so
          ? eq(invoice.salesOrderId, so.id)
          : eq(invoice.customerPoId, id),
      )
      .orderBy(asc(invoice.createdAt)),
    poLinkRows.length > 0
      ? db.select({
          id: purchaseOrder.id, poNo: purchaseOrder.poNo, status: purchaseOrder.status,
          createdAt: purchaseOrder.createdAt, grandTotal: purchaseOrder.grandTotal,
        }).from(purchaseOrder)
          .where(inArray(purchaseOrder.id, poLinkRows.map((r) => r.purchaseOrderId)))
          .orderBy(asc(purchaseOrder.createdAt))
      : Promise.resolve([]),
  ]);

  return {
    cpo,
    createdByName: userRows[0]?.name ?? null,
    so,
    internalPos: internalPoRows,
    dos: dosRows,
    invoices: invoiceRows,
  };
}

export type PaymentStatus = "none" | "unpaid" | "partial" | "paid" | "overdue";

export interface CustomerPoSummaryInvoice {
  id: string;
  invoiceNo: string;
  status: string;
  grandTotal: string;
  paidAmount: string | null;
  dueDate: Date | null;
  createdAt: Date;
}

export interface CustomerPoSummaryRow {
  cpo: CustomerPo;
  soNo: string | null;
  soStatus: string | null;
  soId: string | null;
  internalPoCount: number;
  doTotal: number;
  doDelivered: number;
  invoices: CustomerPoSummaryInvoice[];   // all invoices linked to this CPO
  invoiceTotal: number;
  paidAmount: number;
  paymentStatus: PaymentStatus;
  dueDate: Date | null;
}

export async function getCustomerPoSummary(): Promise<CustomerPoSummaryRow[]> {
  const { orgId } = await requireAccess("customer-po:read");

  const cpos = await db
    .select()
    .from(customerPurchaseOrder)
    .where(eq(customerPurchaseOrder.organizationId, orgId))
    .orderBy(desc(customerPurchaseOrder.createdAt));

  if (cpos.length === 0) return [];

  const cpoIds  = cpos.map((c) => c.id);
  const soIds   = cpos.map((c) => c.salesOrderId).filter((x): x is string => !!x);

  // Parallel bulk fetches
  const [soRows, doRows, invoiceRows, poLinkRows] = await Promise.all([
    soIds.length > 0
      ? db.select({
          id: salesOrder.id, soNo: salesOrder.soNo, status: salesOrder.status,
        }).from(salesOrder).where(inArray(salesOrder.id, soIds))
      : Promise.resolve([] as { id: string; soNo: string; status: string }[]),

    soIds.length > 0
      ? db.select({
          salesOrderId: deliveryOrder.salesOrderId,
          status: deliveryOrder.status,
        }).from(deliveryOrder).where(inArray(deliveryOrder.salesOrderId, soIds))
      : Promise.resolve([] as { salesOrderId: string | null; status: string }[]),

    db.select({
      id: invoice.id, invoiceNo: invoice.invoiceNo, status: invoice.status,
      grandTotal: invoice.grandTotal, paidAmount: invoice.paidAmount,
      dueDate: invoice.dueDate, createdAt: invoice.createdAt,
      salesOrderId: invoice.salesOrderId, customerPoId: invoice.customerPoId,
    }).from(invoice)
      .where(
        soIds.length > 0
          ? or(inArray(invoice.customerPoId, cpoIds), inArray(invoice.salesOrderId, soIds))!
          : inArray(invoice.customerPoId, cpoIds),
      )
      .orderBy(desc(invoice.createdAt)),

    db.select({
      customerPoId: purchaseOrderCustomerPo.customerPoId,
      purchaseOrderId: purchaseOrderCustomerPo.purchaseOrderId,
    }).from(purchaseOrderCustomerPo)
      .where(inArray(purchaseOrderCustomerPo.customerPoId, cpoIds)),
  ]);

  // Build lookup maps
  const soMap     = new Map(soRows.map((s) => [s.id, s]));
  const dosBySo   = new Map<string, typeof doRows>();
  for (const d of doRows) {
    if (!d.salesOrderId) continue;
    if (!dosBySo.has(d.salesOrderId)) dosBySo.set(d.salesOrderId, []);
    dosBySo.get(d.salesOrderId)!.push(d);
  }
  const invBySo   = new Map<string, typeof invoiceRows>();
  const invByCpo  = new Map<string, typeof invoiceRows>();
  for (const inv of invoiceRows) {
    if (inv.salesOrderId) {
      if (!invBySo.has(inv.salesOrderId)) invBySo.set(inv.salesOrderId, []);
      invBySo.get(inv.salesOrderId)!.push(inv);
    } else if (inv.customerPoId) {
      if (!invByCpo.has(inv.customerPoId)) invByCpo.set(inv.customerPoId, []);
      invByCpo.get(inv.customerPoId)!.push(inv);
    }
  }
  const poCountByCpo = new Map<string, number>();
  for (const link of poLinkRows) {
    poCountByCpo.set(link.customerPoId, (poCountByCpo.get(link.customerPoId) ?? 0) + 1);
  }

  return cpos.map((cpo) => {
    const so  = cpo.salesOrderId ? (soMap.get(cpo.salesOrderId) ?? null) : null;
    const dos = so ? (dosBySo.get(so.id) ?? []) : [];
    const invs = so
      ? (invBySo.get(so.id) ?? invByCpo.get(cpo.id) ?? [])
      : (invByCpo.get(cpo.id) ?? []);

    const doDelivered  = dos.filter((d) => d.status === "delivered").length;
    const invoiceTotal = invs.reduce((s, i) => s + Number(i.grandTotal ?? 0), 0);
    const paidAmount   = invs.reduce((s, i) => s + Number(i.paidAmount ?? 0), 0);

    let paymentStatus: PaymentStatus = "none";
    if (invs.length > 0) {
      if (invs.every((i) => i.status === "paid"))        paymentStatus = "paid";
      else if (invs.some((i) => i.status === "overdue")) paymentStatus = "overdue";
      else if (paidAmount > 0)                           paymentStatus = "partial";
      else                                               paymentStatus = "unpaid";
    }

    const latestDue = invs.reduce<Date | null>((d, i) => {
      if (!i.dueDate) return d;
      const dt = new Date(i.dueDate);
      return !d || dt > d ? dt : d;
    }, null);

    return {
      cpo,
      soNo:          so?.soNo ?? null,
      soStatus:      so?.status ?? null,
      soId:          so?.id ?? null,
      internalPoCount: poCountByCpo.get(cpo.id) ?? 0,
      doTotal:       dos.length,
      doDelivered,
      invoices: invs.map((i) => ({
        id:          i.id,
        invoiceNo:   i.invoiceNo,
        status:      i.status,
        grandTotal:  i.grandTotal,
        paidAmount:  i.paidAmount,
        dueDate:     i.dueDate,
        createdAt:   i.createdAt,
      })),
      invoiceTotal,
      paidAmount,
      paymentStatus,
      dueDate:       latestDue,
    };
  });
}

export async function deleteCustomerPo(id: string): Promise<void> {
  const { orgId } = await requireAccess("customer-po:delete");
  const [existing] = await db
    .select()
    .from(customerPurchaseOrder)
    .where(and(eq(customerPurchaseOrder.id, id), eq(customerPurchaseOrder.organizationId, orgId)));
  if (existing?.documentKey) await deleteDocument(existing.documentKey);
  await db.delete(customerPurchaseOrder).where(eq(customerPurchaseOrder.id, id));
}
