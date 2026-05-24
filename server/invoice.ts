"use server";

import { db } from "@/db";
import {
  invoice,
  invoiceItem,
  invoiceExpense,
  invoiceCounter,
  customer,
  customerCompany,
  customerPurchaseOrder,
  purchaseOrder,
  supplier,
  member,
  user,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getNumberingConfig } from "@/server/document-numbering";
import { buildDocumentNo } from "@/lib/document-numbering";

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

async function generateInvoiceNo(orgId: string): Promise<string> {
  const cfg = await getNumberingConfig(orgId, "inv");
  const year = new Date().getFullYear();
  const existing = await db
    .select()
    .from(invoiceCounter)
    .where(eq(invoiceCounter.organizationId, orgId))
    .limit(1);
  let nextNo: number;
  if (existing.length === 0) {
    await db.insert(invoiceCounter).values({ id: nanoid(), organizationId: orgId, year, lastNumber: 1 });
    nextNo = 1;
  } else {
    const counter = existing[0];
    nextNo = counter.year === year ? counter.lastNumber + 1 : 1;
    await db.update(invoiceCounter).set({ year, lastNumber: nextNo }).where(eq(invoiceCounter.organizationId, orgId));
  }
  return buildDocumentNo(cfg, year, nextNo);
}

// ── Types ──────────────────────────────────────────────────────────────────

export type InvoiceRow = typeof invoice.$inferSelect;
export type InvoiceItem = typeof invoiceItem.$inferSelect;
export type InvoiceExpense = typeof invoiceExpense.$inferSelect;
export type InvoiceWithDetails = InvoiceRow & {
  items: InvoiceItem[];
  expenses: InvoiceExpense[];
  createdByName: string | null;
};
export type InvoiceListRow = InvoiceRow & { createdByName: string | null };

const EDITABLE_STATUSES = new Set(["draft"]);
const DELETABLE_STATUSES = new Set(["draft", "cancelled"]);

export interface InvoiceItemInput {
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
  costUnitPrice?: string;
  costTotal?: string;
}

export interface InvoiceExpenseInput {
  description: string;
  category?: string;
  amount: string;
}

export interface CreateInvoiceInput {
  invoiceDate?: Date;

  // Customer
  customerId?: string;
  customerCompanyId?: string;
  customerPoId?: string;
  customerPoNo?: string;

  // Document links
  quotationId?: string;
  quotationNo?: string;
  salesOrderId?: string;
  salesOrderNo?: string;
  deliveryOrderId?: string;
  deliveryOrderNo?: string;

  // Supplier / cost
  purchaseOrderId?: string;
  supplierId?: string;

  // Sales
  salesPersonId?: string;
  salesPersonName?: string;

  // Pricing
  subtotal?: string;
  overallDiscountPct?: string;
  overallDiscountAmt?: string;
  sstPct?: string;
  sst?: string;
  grandTotal?: string;

  // Cost
  costTotal?: string;
  expensesTotal?: string;
  profit?: string;

  // Payment
  status?: string;
  paymentTerms?: string;
  dueDate?: Date;

  notes?: string;
  items: InvoiceItemInput[];
  expenses: InvoiceExpenseInput[];
}

export interface UpdateInvoiceInput extends Omit<CreateInvoiceInput, "items" | "expenses"> {
  id: string;
  paidAt?: Date;
  paidAmount?: string;
  items: InvoiceItemInput[];
  expenses: InvoiceExpenseInput[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function calcProfit(grandTotal: string, costTotal: string, expensesTotal: string): string {
  const g = parseFloat(grandTotal || "0");
  const c = parseFloat(costTotal || "0");
  const e = parseFloat(expensesTotal || "0");
  return (g - c - e).toFixed(2);
}

// ── Queries ────────────────────────────────────────────────────────────────

export async function getInvoices(): Promise<InvoiceListRow[]> {
  const { orgId, userId } = await requireAccess("invoice:read");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);
  const rows = await db
    .select()
    .from(invoice)
    .where(eq(invoice.organizationId, ownerOrgId))
    .orderBy(desc(invoice.createdAt));

  if (rows.length === 0) return [];

  const creatorIds = [...new Set(rows.map((r) => r.createdBy))];
  const users = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, creatorIds));
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? null;

  return rows.map((r) => ({ ...r, createdByName: nameOf(r.createdBy) }));
}

export async function getInvoiceDetail(id: string): Promise<InvoiceWithDetails | null> {
  const { orgId, userId } = await requireAccess("invoice:read");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);
  const [inv] = await db
    .select()
    .from(invoice)
    .where(and(eq(invoice.id, id), eq(invoice.organizationId, ownerOrgId)));
  if (!inv) return null;
  const [items, expenses, users] = await Promise.all([
    db.select().from(invoiceItem).where(eq(invoiceItem.invoiceId, id)).orderBy(asc(invoiceItem.rowNo)),
    db.select().from(invoiceExpense).where(eq(invoiceExpense.invoiceId, id)).orderBy(asc(invoiceExpense.createdAt)),
    db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, [inv.createdBy])),
  ]);
  const nameOf = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? null;
  return { ...inv, items, expenses, createdByName: nameOf(inv.createdBy) };
}

// ── Mutations ──────────────────────────────────────────────────────────────

export async function createInvoice(input: CreateInvoiceInput): Promise<InvoiceRow> {
  const { orgId, userId } = await requireAccess("invoice:create");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);

  // Customer snapshot
  let customerSnapshot: InvoiceRow["customerSnapshot"] = null;
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

  // Supplier snapshot
  let supplierSnapshot: InvoiceRow["supplierSnapshot"] = null;
  const resolvedSupplierId = input.supplierId ?? (
    input.purchaseOrderId
      ? await db.select({ supplierId: purchaseOrder.supplierId }).from(purchaseOrder).where(eq(purchaseOrder.id, input.purchaseOrderId!)).then(([r]) => r?.supplierId ?? null)
      : null
  );
  if (resolvedSupplierId) {
    const [sup] = await db.select().from(supplier).where(eq(supplier.id, resolvedSupplierId));
    if (sup) {
      supplierSnapshot = {
        name: sup.name,
        registrationNo: sup.registrationNo ?? undefined,
        contactPerson: sup.contactPerson ?? undefined,
        contactNo: sup.contactNo ?? undefined,
        email: sup.email ?? undefined,
      };
    }
  }

  // Customer PO no. lookup
  let resolvedCustomerPoNo = input.customerPoNo ?? null;
  if (input.customerPoId && !resolvedCustomerPoNo) {
    const [cpo] = await db.select({ customerPoNo: customerPurchaseOrder.customerPoNo }).from(customerPurchaseOrder).where(eq(customerPurchaseOrder.id, input.customerPoId));
    resolvedCustomerPoNo = cpo?.customerPoNo ?? null;
  }

  const grandTotal = input.grandTotal ?? "0";
  const costTotal = input.costTotal ?? "0";
  const expensesTotal = input.expensesTotal ?? "0";

  const invoiceNo = await generateInvoiceNo(ownerOrgId);
  const [row] = await db
    .insert(invoice)
    .values({
      id: nanoid(),
      organizationId: ownerOrgId,
      invoiceNo,
      invoiceDate: input.invoiceDate ?? new Date(),
      customerId: input.customerId ?? null,
      customerSnapshot,
      customerPoId: input.customerPoId ?? null,
      customerPoNo: resolvedCustomerPoNo,
      quotationId: input.quotationId ?? null,
      quotationNo: input.quotationNo ?? null,
      salesOrderId: input.salesOrderId ?? null,
      salesOrderNo: input.salesOrderNo ?? null,
      deliveryOrderId: input.deliveryOrderId ?? null,
      deliveryOrderNo: input.deliveryOrderNo ?? null,
      purchaseOrderId: input.purchaseOrderId ?? null,
      supplierId: resolvedSupplierId ?? null,
      supplierSnapshot,
      salesPersonId: input.salesPersonId ?? null,
      salesPersonName: input.salesPersonName ?? null,
      subtotal: input.subtotal ?? "0",
      overallDiscountPct: input.overallDiscountPct ?? "0",
      overallDiscountAmt: input.overallDiscountAmt ?? "0",
      sstPct: input.sstPct ?? "0",
      sst: input.sst ?? "0",
      grandTotal,
      costTotal,
      expensesTotal,
      profit: calcProfit(grandTotal, costTotal, expensesTotal),
      status: input.status ?? "draft",
      paymentTerms: input.paymentTerms ?? null,
      dueDate: input.dueDate ?? null,
      notes: input.notes ?? null,
      createdBy: userId,
    })
    .returning();

  if (input.items.length > 0) {
    await db.insert(invoiceItem).values(
      input.items.map((i) => ({
        id: nanoid(),
        invoiceId: row.id,
        rowNo: i.rowNo,
        productId: i.productId ?? null,
        productCode: i.productCode ?? null,
        description: i.description ?? null,
        qty: i.qty ?? "1",
        uom: i.uom ?? null,
        unitPrice: i.unitPrice ?? "0",
        discountPct: i.discountPct ?? "0",
        discountAmt: i.discountAmt ?? "0",
        totalPrice: i.totalPrice ?? "0",
        costUnitPrice: i.costUnitPrice ?? "0",
        costTotal: i.costTotal ?? "0",
      })),
    );
  }

  if (input.expenses.length > 0) {
    await db.insert(invoiceExpense).values(
      input.expenses.map((e) => ({
        id: nanoid(),
        invoiceId: row.id,
        description: e.description,
        category: e.category ?? "other",
        amount: e.amount,
      })),
    );
  }

  return row;
}

export async function updateInvoice(input: UpdateInvoiceInput): Promise<InvoiceRow> {
  const { orgId, userId } = await requireAccess("invoice:update");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);
  const [existing] = await db
    .select()
    .from(invoice)
    .where(and(eq(invoice.id, input.id), eq(invoice.organizationId, ownerOrgId)));
  if (!existing) throw new Error("Invoice not found");
  if (!EDITABLE_STATUSES.has(existing.status)) throw new Error("Only draft invoices can be edited");

  const grandTotal = input.grandTotal ?? existing.grandTotal;
  const costTotal = input.costTotal ?? existing.costTotal ?? "0";
  const expensesTotal = input.expensesTotal ?? existing.expensesTotal ?? "0";

  const [row] = await db
    .update(invoice)
    .set({
      invoiceDate: input.invoiceDate ?? existing.invoiceDate,
      customerId: input.customerId ?? null,
      customerPoId: input.customerPoId ?? null,
      customerPoNo: input.customerPoNo ?? null,
      quotationId: input.quotationId ?? null,
      quotationNo: input.quotationNo ?? null,
      salesOrderId: input.salesOrderId ?? null,
      salesOrderNo: input.salesOrderNo ?? null,
      deliveryOrderId: input.deliveryOrderId ?? null,
      deliveryOrderNo: input.deliveryOrderNo ?? null,
      purchaseOrderId: input.purchaseOrderId ?? null,
      supplierId: input.supplierId ?? null,
      salesPersonId: input.salesPersonId ?? null,
      salesPersonName: input.salesPersonName ?? null,
      subtotal: input.subtotal ?? existing.subtotal,
      overallDiscountPct: input.overallDiscountPct ?? existing.overallDiscountPct,
      overallDiscountAmt: input.overallDiscountAmt ?? existing.overallDiscountAmt,
      sstPct: input.sstPct ?? existing.sstPct,
      sst: input.sst ?? existing.sst,
      grandTotal,
      costTotal,
      expensesTotal,
      profit: calcProfit(grandTotal, costTotal, expensesTotal),
      status: input.status ?? existing.status,
      paymentTerms: input.paymentTerms ?? null,
      dueDate: input.dueDate ?? null,
      paidAt: input.paidAt ?? null,
      paidAmount: input.paidAmount ?? null,
      notes: input.notes ?? null,
    })
    .where(eq(invoice.id, input.id))
    .returning();

  await db.delete(invoiceItem).where(eq(invoiceItem.invoiceId, input.id));
  await db.delete(invoiceExpense).where(eq(invoiceExpense.invoiceId, input.id));

  if (input.items.length > 0) {
    await db.insert(invoiceItem).values(
      input.items.map((i) => ({
        id: nanoid(),
        invoiceId: input.id,
        rowNo: i.rowNo,
        productId: i.productId ?? null,
        productCode: i.productCode ?? null,
        description: i.description ?? null,
        qty: i.qty ?? "1",
        uom: i.uom ?? null,
        unitPrice: i.unitPrice ?? "0",
        discountPct: i.discountPct ?? "0",
        discountAmt: i.discountAmt ?? "0",
        totalPrice: i.totalPrice ?? "0",
        costUnitPrice: i.costUnitPrice ?? "0",
        costTotal: i.costTotal ?? "0",
      })),
    );
  }

  if (input.expenses.length > 0) {
    await db.insert(invoiceExpense).values(
      input.expenses.map((e) => ({
        id: nanoid(),
        invoiceId: input.id,
        description: e.description,
        category: e.category ?? "other",
        amount: e.amount,
      })),
    );
  }

  return row;
}

export async function deleteInvoice(id: string): Promise<void> {
  const { orgId, userId } = await requireAccess("invoice:delete");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);
  const [existing] = await db.select().from(invoice).where(and(eq(invoice.id, id), eq(invoice.organizationId, ownerOrgId)));
  if (!existing) throw new Error("Invoice not found");
  if (!DELETABLE_STATUSES.has(existing.status)) throw new Error("Only draft or cancelled invoices can be deleted");
  await db.delete(invoice).where(and(eq(invoice.id, id), eq(invoice.organizationId, ownerOrgId)));
}

export async function updateInvoiceStatus(id: string, status: string, paidAt?: Date, paidAmount?: string): Promise<void> {
  const { orgId, userId } = await requireAccess("invoice:update");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);
  await db
    .update(invoice)
    .set({ status, ...(paidAt ? { paidAt, paidAmount: paidAmount ?? null } : {}) })
    .where(and(eq(invoice.id, id), eq(invoice.organizationId, ownerOrgId)));
}

export async function sendInvoice(id: string): Promise<void> {
  const { orgId, userId } = await requireAccess("invoice:update");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);
  const [existing] = await db.select().from(invoice).where(and(eq(invoice.id, id), eq(invoice.organizationId, ownerOrgId)));
  if (!existing) throw new Error("Invoice not found");
  if (existing.status !== "draft") throw new Error("Only draft invoices can be sent");
  await db.update(invoice).set({ status: "sent" }).where(eq(invoice.id, id));
}

export async function markInvoicePaid(id: string, paidAmount?: string): Promise<void> {
  const { orgId, userId } = await requireAccess("invoice:update");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);
  const [existing] = await db.select().from(invoice).where(and(eq(invoice.id, id), eq(invoice.organizationId, ownerOrgId)));
  if (!existing) throw new Error("Invoice not found");
  if (!["sent", "overdue"].includes(existing.status)) throw new Error("Only sent or overdue invoices can be marked as paid");
  await db.update(invoice).set({ status: "paid", paidAt: new Date(), paidAmount: paidAmount ?? existing.grandTotal }).where(eq(invoice.id, id));
}

export async function markInvoiceOverdue(id: string): Promise<void> {
  const { orgId, userId } = await requireAccess("invoice:update");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);
  const [existing] = await db.select().from(invoice).where(and(eq(invoice.id, id), eq(invoice.organizationId, ownerOrgId)));
  if (!existing) throw new Error("Invoice not found");
  if (existing.status !== "sent") throw new Error("Only sent invoices can be marked as overdue");
  await db.update(invoice).set({ status: "overdue" }).where(eq(invoice.id, id));
}

export async function cancelInvoice(id: string): Promise<void> {
  const { orgId, userId } = await requireAccess("invoice:update");
  const ownerOrgId = await getOwnerOrgId(userId, orgId);
  const [existing] = await db.select().from(invoice).where(and(eq(invoice.id, id), eq(invoice.organizationId, ownerOrgId)));
  if (!existing) throw new Error("Invoice not found");
  if (["paid", "cancelled"].includes(existing.status)) throw new Error("Cannot cancel a paid or already cancelled invoice");
  await db.update(invoice).set({ status: "cancelled" }).where(eq(invoice.id, id));
}
