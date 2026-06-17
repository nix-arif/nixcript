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
  user,
  ledgerEntry,
  ledgerLine,
  ledgerEntryInvoice,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { nanoid } from "nanoid";
import { eq, and, desc, asc, inArray, or } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { getNumberingConfig } from "@/server/document-numbering";
import { buildDocumentNo } from "@/lib/document-numbering";

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

// ── SOA types ──────────────────────────────────────────────────────────────
export interface SoaInvoice {
  id: string;
  invoiceNo: string;
  invoiceDate: Date;
  customerPoNo: string | null;
  salesOrderNo: string | null;
  caseType: string | null;
  caseDate: Date | null;
  mrnNo: string | null;
  grandTotal: string;
  paidAmount: string | null;
  paidAt: Date | null;
  dueDate: Date | null;
  status: string;
  soaVerified: boolean;
}

export interface SoaOrganization {
  organizationName: string;
  invoices: SoaInvoice[];
  totalBilled: number;
  totalPaid: number;
  outstanding: number;
  overdueCount: number;
  soaVerifiedCount: number;
}

// ── Live customer snapshot helper ──────────────────────────────────────────
// Fetches the current customer name + primary company from the live tables so
// that display views always reflect the latest data, even if the stored
// customerSnapshot JSON is stale from a prior edit.

type LiveCustomerData = {
  title: string | null;
  name: string;
  email: string | null;
  contactNo: string | null;
  organizationName: string | null;
  organizationAddress: string | null;
};

async function getLiveCustomerMap(customerIds: string[]): Promise<Map<string, LiveCustomerData>> {
  if (customerIds.length === 0) return new Map();
  const [customers, companies] = await Promise.all([
    db.select({ id: customer.id, title: customer.title, name: customer.name, email: customer.email, contactNo: customer.contactNo })
      .from(customer)
      .where(inArray(customer.id, customerIds)),
    db.select({ customerId: customerCompany.customerId, organizationName: customerCompany.organizationName, organizationAddress: customerCompany.organizationAddress })
      .from(customerCompany)
      .where(and(inArray(customerCompany.customerId, customerIds), eq(customerCompany.isPrimary, true))),
  ]);
  const companyMap = Object.fromEntries(companies.map((c) => [c.customerId, c]));
  const result = new Map<string, LiveCustomerData>();
  for (const c of customers) {
    const co = companyMap[c.id];
    result.set(c.id, {
      title: c.title ?? null,
      name: c.name,
      email: c.email ?? null,
      contactNo: c.contactNo ?? null,
      organizationName: co?.organizationName ?? null,
      organizationAddress: co?.organizationAddress ?? null,
    });
  }
  return result;
}

function mergeSnapshot(
  snapshot: InvoiceRow["customerSnapshot"],
  live: LiveCustomerData | undefined,
): InvoiceRow["customerSnapshot"] {
  if (!live) return snapshot;
  return {
    ...(snapshot ?? {}),
    title: live.title ?? undefined,
    name: live.name,
    email: live.email ?? snapshot?.email,
    contactNo: live.contactNo ?? snapshot?.contactNo,
    organizationName: live.organizationName ?? snapshot?.organizationName,
    organizationAddress: live.organizationAddress ?? snapshot?.organizationAddress,
  };
}

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
  const { orgId } = await requireAccess("invoice:read");
  const rows = await db
    .select()
    .from(invoice)
    .where(eq(invoice.organizationId, orgId))
    .orderBy(desc(invoice.createdAt));

  if (rows.length === 0) return [];

  const creatorIds = [...new Set(rows.map((r) => r.createdBy))];
  const customerIds = [...new Set(rows.map((r) => r.customerId).filter(Boolean))] as string[];
  const [users, liveCustomers] = await Promise.all([
    db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, creatorIds)),
    getLiveCustomerMap(customerIds),
  ]);
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? null;

  return rows.map((r) => ({
    ...r,
    customerSnapshot: mergeSnapshot(r.customerSnapshot, r.customerId ? liveCustomers.get(r.customerId) : undefined),
    createdByName: nameOf(r.createdBy),
  }));
}

export async function getStatementOfAccount(): Promise<SoaOrganization[]> {
  const { orgId } = await requireAccess("invoice:read");

  const rows = await db
    .select()
    .from(invoice)
    .where(
      and(
        eq(invoice.organizationId, orgId),
        // Exclude draft invoices from SOA
      ),
    )
    .orderBy(desc(invoice.invoiceDate));

  // Group by live organizationName (falls back to snapshot then placeholder)
  const soaCustomerIds = [...new Set(rows.map((r) => r.customerId).filter(Boolean))] as string[];
  const liveCustomers = await getLiveCustomerMap(soaCustomerIds);

  const map = new Map<string, SoaInvoice[]>();
  for (const r of rows) {
    const live = r.customerId ? liveCustomers.get(r.customerId) : undefined;
    const snap = r.customerSnapshot as { organizationName?: string } | null;
    const orgName = live?.organizationName?.trim() || snap?.organizationName?.trim() || "— No Hospital —";
    if (!map.has(orgName)) map.set(orgName, []);
    map.get(orgName)!.push({
      id: r.id,
      invoiceNo: r.invoiceNo,
      invoiceDate: r.invoiceDate,
      customerPoNo: r.customerPoNo,
      salesOrderNo: r.salesOrderNo,
      caseType: r.caseType,
      caseDate: r.caseDate,
      mrnNo: r.mrnNo,
      grandTotal: r.grandTotal,
      paidAmount: r.paidAmount,
      paidAt: r.paidAt,
      dueDate: r.dueDate,
      status: r.status,
      soaVerified: r.soaVerified,
    });
  }

  // Build SoaOrganization summary per hospital
  const result: SoaOrganization[] = [];
  for (const [organizationName, invoices] of map) {
    const totalBilled = invoices.reduce((s, i) => s + parseFloat(i.grandTotal || "0"), 0);
    const totalPaid = invoices.reduce((s, i) => {
      if (i.status === "paid") return s + parseFloat(i.grandTotal || "0");
      return s + parseFloat(i.paidAmount || "0");
    }, 0);
    const outstanding = invoices.reduce((s, i) => {
      if (i.status === "paid" || i.status === "cancelled") return s;
      return s + Math.max(0, parseFloat(i.grandTotal || "0") - parseFloat(i.paidAmount || "0"));
    }, 0);
    const overdueCount = invoices.filter((i) => i.status === "overdue").length;
    const soaVerifiedCount = invoices.filter((i) => i.soaVerified).length;

    result.push({ organizationName, invoices, totalBilled, totalPaid, outstanding, overdueCount, soaVerifiedCount });
  }

  // Sort: hospitals with outstanding first, then by name
  result.sort((a, b) => {
    if (b.outstanding !== a.outstanding) return b.outstanding - a.outstanding;
    return a.organizationName.localeCompare(b.organizationName);
  });

  return result;
}

export async function markSoaVerified(invoiceIds: string[], verified: boolean): Promise<void> {
  const { orgId } = await requireAccess("invoice:update");
  if (invoiceIds.length === 0) return;
  await db
    .update(invoice)
    .set({ soaVerified: verified })
    .where(and(inArray(invoice.id, invoiceIds), eq(invoice.organizationId, orgId)));
}

export async function getInvoiceDetail(id: string): Promise<InvoiceWithDetails | null> {
  const { orgId } = await requireAccess("invoice:read");
  const [inv] = await db
    .select()
    .from(invoice)
    .where(and(eq(invoice.id, id), eq(invoice.organizationId, orgId)));
  if (!inv) return null;
  const [items, expenses, users] = await Promise.all([
    db.select().from(invoiceItem).where(eq(invoiceItem.invoiceId, id)).orderBy(asc(invoiceItem.rowNo)),
    db.select().from(invoiceExpense).where(eq(invoiceExpense.invoiceId, id)).orderBy(asc(invoiceExpense.createdAt)),
    db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, [inv.createdBy])),
  ]);
  const nameOf = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? null;
  const liveCustomers = await getLiveCustomerMap(inv.customerId ? [inv.customerId] : []);
  const live = inv.customerId ? liveCustomers.get(inv.customerId) : undefined;
  return {
    ...inv,
    customerSnapshot: mergeSnapshot(inv.customerSnapshot, live),
    items,
    expenses,
    createdByName: nameOf(inv.createdBy),
  };
}

export type LinkedJournalEntry = {
  id: string;
  entryNo: string;
  date: string;
  description: string;
  transactionType: string;
  status: string;
  totalDebit: string;
  totalCredit: string;
};

export async function getLinkedJournalEntries(invoiceId: string): Promise<LinkedJournalEntry[]> {
  const { orgId } = await requireAccess("invoice:read");

  // Find entry IDs linked via the junction table
  const junctionRows = await db
    .select({ entryId: ledgerEntryInvoice.entryId })
    .from(ledgerEntryInvoice)
    .where(eq(ledgerEntryInvoice.invoiceId, invoiceId));
  const junctionEntryIds = junctionRows.map((r) => r.entryId);

  const entries = await db
    .select({
      id: ledgerEntry.id,
      entryNo: ledgerEntry.entryNo,
      date: ledgerEntry.date,
      description: ledgerEntry.description,
      transactionType: ledgerEntry.transactionType,
      status: ledgerEntry.status,
    })
    .from(ledgerEntry)
    .where(
      and(
        eq(ledgerEntry.organizationId, orgId),
        or(
          and(eq(ledgerEntry.referenceType, "INVOICE"), eq(ledgerEntry.referenceId, invoiceId)),
          junctionEntryIds.length > 0 ? inArray(ledgerEntry.id, junctionEntryIds) : undefined,
        ),
      ),
    )
    .orderBy(asc(ledgerEntry.date), asc(ledgerEntry.entryNo));

  if (entries.length === 0) return [];

  const entryIds = entries.map((e) => e.id);
  const lines = await db
    .select({ entryId: ledgerLine.entryId, debit: ledgerLine.debit, credit: ledgerLine.credit })
    .from(ledgerLine)
    .where(inArray(ledgerLine.entryId, entryIds));

  const totals = new Map<string, { debit: number; credit: number }>();
  for (const l of lines) {
    const t = totals.get(l.entryId) ?? { debit: 0, credit: 0 };
    t.debit += parseFloat(l.debit ?? "0");
    t.credit += parseFloat(l.credit ?? "0");
    totals.set(l.entryId, t);
  }

  return entries.map((e) => {
    const t = totals.get(e.id) ?? { debit: 0, credit: 0 };
    return {
      ...e,
      totalDebit: t.debit.toFixed(2),
      totalCredit: t.credit.toFixed(2),
    };
  });
}

// ── Mutations ──────────────────────────────────────────────────────────────

export async function createInvoice(input: CreateInvoiceInput): Promise<InvoiceRow> {
  const { orgId, userId } = await requireAccess("invoice:create");

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

  const invoiceNo = await generateInvoiceNo(orgId);
  const [row] = await db
    .insert(invoice)
    .values({
      id: nanoid(),
      organizationId: orgId,
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
  const { orgId } = await requireAccess("invoice:update");
  const [existing] = await db
    .select()
    .from(invoice)
    .where(and(eq(invoice.id, input.id), eq(invoice.organizationId, orgId)));
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
  const { orgId } = await requireAccess("invoice:delete");
  const [existing] = await db.select().from(invoice).where(and(eq(invoice.id, id), eq(invoice.organizationId, orgId)));
  if (!existing) throw new Error("Invoice not found");
  if (!DELETABLE_STATUSES.has(existing.status)) throw new Error("Only draft or cancelled invoices can be deleted");
  await db.delete(invoice).where(eq(invoice.id, id));
}

export async function updateInvoiceStatus(id: string, status: string, paidAt?: Date, paidAmount?: string): Promise<void> {
  const { orgId } = await requireAccess("invoice:update");
  const [existing] = await db.select({ id: invoice.id }).from(invoice).where(and(eq(invoice.id, id), eq(invoice.organizationId, orgId)));
  if (!existing) throw new Error("Invoice not found");
  await db
    .update(invoice)
    .set({ status, ...(paidAt ? { paidAt, paidAmount: paidAmount ?? null } : {}) })
    .where(eq(invoice.id, id));
}

export async function sendInvoice(id: string): Promise<void> {
  const { orgId } = await requireAccess("invoice:update");
  const [existing] = await db.select().from(invoice).where(and(eq(invoice.id, id), eq(invoice.organizationId, orgId)));
  if (!existing) throw new Error("Invoice not found");
  if (existing.status !== "draft") throw new Error("Only draft invoices can be sent");
  await db.update(invoice).set({ status: "sent" }).where(eq(invoice.id, id));
}

export async function markInvoicePaid(id: string, paidAmount?: string): Promise<void> {
  const { orgId } = await requireAccess("invoice:update");
  const [existing] = await db.select().from(invoice).where(and(eq(invoice.id, id), eq(invoice.organizationId, orgId)));
  if (!existing) throw new Error("Invoice not found");
  if (!["sent", "overdue"].includes(existing.status)) throw new Error("Only sent or overdue invoices can be marked as paid");
  await db.update(invoice).set({ status: "paid", paidAt: new Date(), paidAmount: paidAmount ?? existing.grandTotal }).where(eq(invoice.id, id));
}

export async function markInvoiceOverdue(id: string): Promise<void> {
  const { orgId } = await requireAccess("invoice:update");
  const [existing] = await db.select().from(invoice).where(and(eq(invoice.id, id), eq(invoice.organizationId, orgId)));
  if (!existing) throw new Error("Invoice not found");
  if (existing.status !== "sent") throw new Error("Only sent invoices can be marked as overdue");
  await db.update(invoice).set({ status: "overdue" }).where(eq(invoice.id, id));
}

export async function cancelInvoice(id: string): Promise<void> {
  const { orgId } = await requireAccess("invoice:update");
  const [existing] = await db.select().from(invoice).where(and(eq(invoice.id, id), eq(invoice.organizationId, orgId)));
  if (!existing) throw new Error("Invoice not found");
  if (["paid", "cancelled"].includes(existing.status)) throw new Error("Cannot cancel a paid or already cancelled invoice");
  await db.update(invoice).set({ status: "cancelled" }).where(eq(invoice.id, id));
}
