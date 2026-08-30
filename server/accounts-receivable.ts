"use server";

import { db } from "@/db";
import {
  ledgerAccount, ledgerEntry, ledgerLine,
  customer, customerCompany, customerOrganization, invoice,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { eq, and, inArray, desc, asc } from "drizzle-orm";
import { insertLedgerEntry, type CreateLedgerEntryInput } from "@/server/ledger";

// ── Session helper ─────────────────────────────────────────────────────────

async function requireAccess(permission: string) {
  const session = await getCachedSession();
  if (!session) throw new Error("You must be signed in to continue");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  const userId = session.user.id;
  const perms = await getUserPermissions(userId, orgId);
  if (!hasAccess(perms, permission)) throw new Error("You don't have permission to do this");
  return { orgId, userId };
}

// Every ledger account tagged as Accounts Receivable, by subtype rather than
// a hardcoded code — an org may have renamed or re-coded the seeded 1200
// account. This (not a caller-chosen accountId, unlike getSubsidiaryLedger)
// is what actually keeps an accounts-receivable:* holder from ever touching
// AP or member sub-ledgers.
async function getArAccountIds(orgId: string): Promise<string[]> {
  const rows = await db
    .select({ id: ledgerAccount.id })
    .from(ledgerAccount)
    .where(and(eq(ledgerAccount.organizationId, orgId), eq(ledgerAccount.subtype, "ACCOUNTS_RECEIVABLE")));
  return rows.map((r) => r.id);
}

// ── Read: customer balances ─────────────────────────────────────────────────

export type ArBalanceRow = {
  stakeholderId: string;
  stakeholderName: string;
  balance: string;
  // True if this customer has at least one DRAFT entry against AR waiting to
  // be posted — surfaced so a receipt the clerk just keyed in doesn't just
  // vanish from the list until someone else posts it (balance itself only
  // ever reflects POSTED lines, same as the full-ledger Subsidiary Ledger).
  hasDraft: boolean;
};

export async function getArOverview(): Promise<ArBalanceRow[]> {
  const { orgId } = await requireAccess("accounts-receivable:read");
  const arAccountIds = await getArAccountIds(orgId);
  if (arAccountIds.length === 0) return [];

  // Not filtered to status = POSTED — a customer with only a DRAFT entry
  // still needs to show up (with a zero balance) so it can be monitored.
  const rows = await db
    .select({
      stakeholderId: ledgerEntry.stakeholderId,
      stakeholderName: ledgerEntry.stakeholderName,
      status: ledgerEntry.status,
      debit: ledgerLine.debit,
      credit: ledgerLine.credit,
    })
    .from(ledgerLine)
    .innerJoin(ledgerEntry, eq(ledgerLine.entryId, ledgerEntry.id))
    .where(and(
      eq(ledgerEntry.organizationId, orgId),
      eq(ledgerEntry.stakeholderType, "CUSTOMER"),
      inArray(ledgerLine.accountId, arAccountIds),
    ));

  const balanceMap = new Map<string, { name: string; balance: number; hasDraft: boolean }>();
  for (const r of rows) {
    if (!r.stakeholderId) continue;
    const entry = balanceMap.get(r.stakeholderId) ?? { name: r.stakeholderName ?? "Unknown", balance: 0, hasDraft: false };
    if (r.status === "POSTED") entry.balance += parseFloat(r.debit) - parseFloat(r.credit);
    if (r.status === "DRAFT") entry.hasDraft = true;
    balanceMap.set(r.stakeholderId, entry);
  }

  return [...balanceMap.entries()]
    .map(([stakeholderId, v]) => ({ stakeholderId, stakeholderName: v.name, balance: v.balance.toFixed(2), hasDraft: v.hasDraft }))
    .sort((a, b) => a.stakeholderName.localeCompare(b.stakeholderName));
}

// ── Read: per-customer transaction history ──────────────────────────────────

export type ArTransactionRow = {
  entryId: string;
  entryNo: string;
  date: string;
  description: string;
  transactionType: string;
  status: string;
  stakeholderId: string | null;
  stakeholderName: string | null;
  debit: string;
  credit: string;
};

export async function getArTransactions(customerId?: string): Promise<ArTransactionRow[]> {
  const { orgId } = await requireAccess("accounts-receivable:read");
  const arAccountIds = await getArAccountIds(orgId);
  if (arAccountIds.length === 0) return [];

  const rows = await db
    .select({
      entryId: ledgerEntry.id,
      entryNo: ledgerEntry.entryNo,
      date: ledgerEntry.date,
      description: ledgerEntry.description,
      transactionType: ledgerEntry.transactionType,
      status: ledgerEntry.status,
      stakeholderId: ledgerEntry.stakeholderId,
      stakeholderName: ledgerEntry.stakeholderName,
      debit: ledgerLine.debit,
      credit: ledgerLine.credit,
    })
    .from(ledgerLine)
    .innerJoin(ledgerEntry, eq(ledgerLine.entryId, ledgerEntry.id))
    .where(and(
      eq(ledgerEntry.organizationId, orgId),
      eq(ledgerEntry.stakeholderType, "CUSTOMER"),
      inArray(ledgerLine.accountId, arAccountIds),
      customerId ? eq(ledgerEntry.stakeholderId, customerId) : undefined,
    ))
    .orderBy(desc(ledgerEntry.date), desc(ledgerEntry.createdAt));

  return rows;
}

// ── Reference data (for the "Record Receipt" form) ──────────────────────────

export type ArReferenceData = {
  customers: { id: string; name: string; organizationName: string | null }[];
  bankAccounts: { id: string; code: string; name: string }[];
  invoices: { id: string; invoiceNo: string; customerId: string | null }[];
};

export async function getArReferenceData(): Promise<ArReferenceData> {
  const { orgId } = await requireAccess("accounts-receivable:create");

  const [customers, bankAccounts, invoices] = await Promise.all([
    db.select({ id: customer.id, name: customer.name, legacyOrgName: customer.organizationName })
      .from(customer)
      .where(eq(customer.organizationId, orgId))
      .orderBy(asc(customer.name)),
    db.select({ id: ledgerAccount.id, code: ledgerAccount.code, name: ledgerAccount.name })
      .from(ledgerAccount)
      .where(and(
        eq(ledgerAccount.organizationId, orgId),
        eq(ledgerAccount.isActive, true),
        inArray(ledgerAccount.subtype, ["CASH", "BANK"]),
      ))
      .orderBy(asc(ledgerAccount.code)),
    db.select({ id: invoice.id, invoiceNo: invoice.invoiceNo, customerId: invoice.customerId })
      .from(invoice)
      .where(eq(invoice.organizationId, orgId))
      .orderBy(desc(invoice.createdAt))
      .limit(200),
  ]);

  // Same enrichment as getLedgerReferenceData (server/ledger.ts) — primary
  // company name from customerCompany, falling back to the legacy column.
  const customerIds = customers.map((c) => c.id);
  const primaryCompanies = customerIds.length
    ? await db
        .select({ customerId: customerCompany.customerId, organizationName: customerOrganization.name })
        .from(customerCompany)
        .leftJoin(customerOrganization, eq(customerOrganization.id, customerCompany.customerOrganizationId))
        .where(and(inArray(customerCompany.customerId, customerIds), eq(customerCompany.isPrimary, true)))
    : [];
  const primaryMap = Object.fromEntries(primaryCompanies.map((c) => [c.customerId, c.organizationName]));
  const enrichedCustomers = customers.map((c) => ({
    id: c.id,
    name: c.name,
    organizationName: primaryMap[c.id] ?? c.legacyOrgName ?? null,
  }));

  return { customers: enrichedCustomers, bankAccounts, invoices };
}

// ── Create: record a customer receipt ───────────────────────────────────────

export type CreateArReceiptInput = {
  date: string;
  customerId: string;
  bankAccountId: string;
  amount: string;
  description: string;
  invoiceId?: string;
};

export async function createArReceipt(input: CreateArReceiptInput): Promise<string> {
  const { orgId, userId } = await requireAccess("accounts-receivable:create");

  const amount = parseFloat(input.amount || "0");
  if (!amount || amount <= 0) throw new Error("Amount must be greater than zero");

  // The other leg is restricted to CASH/BANK accounts, checked server-side
  // (not just left to the reference-data list the form shows) — this is the
  // actual enforcement boundary that keeps an AR-only holder from posting
  // against an arbitrary account.
  const [bankAccount] = await db
    .select()
    .from(ledgerAccount)
    .where(and(
      eq(ledgerAccount.id, input.bankAccountId),
      eq(ledgerAccount.organizationId, orgId),
      inArray(ledgerAccount.subtype, ["CASH", "BANK"]),
    ));
  if (!bankAccount) throw new Error("Select a valid cash/bank account to receive this payment into");

  const arAccountIds = await getArAccountIds(orgId);
  if (arAccountIds.length === 0) throw new Error("No Accounts Receivable account is set up — ask a ledger admin to set one up first");
  if (arAccountIds.length > 1) throw new Error("Multiple Accounts Receivable accounts exist — ask a ledger admin to record this receipt instead");
  const [arAccount] = await db.select().from(ledgerAccount).where(eq(ledgerAccount.id, arAccountIds[0]));

  const [cust] = await db.select().from(customer).where(and(eq(customer.id, input.customerId), eq(customer.organizationId, orgId)));
  if (!cust) throw new Error("Customer not found");

  // Same display-name resolution as getArReferenceData/the picker (primary
  // company name over the individual contact's own name) — otherwise the
  // customer the clerk picked ("KPJ Klang") doesn't match who shows up in
  // the balance table (cust.name alone, e.g. "Abdul Yazid Mohd Kassim").
  const [primaryCompany] = await db
    .select({ organizationName: customerOrganization.name })
    .from(customerCompany)
    .leftJoin(customerOrganization, eq(customerOrganization.id, customerCompany.customerOrganizationId))
    .where(and(eq(customerCompany.customerId, cust.id), eq(customerCompany.isPrimary, true)));
  const stakeholderName = primaryCompany?.organizationName ?? cust.organizationName ?? cust.name;

  const data: CreateLedgerEntryInput = {
    date: input.date,
    description: input.description || `Payment received from ${stakeholderName}`,
    transactionType: "CUSTOMER_PAYMENT",
    stakeholderType: "CUSTOMER",
    stakeholderId: cust.id,
    stakeholderName,
    referenceType: input.invoiceId ? "INVOICE" : undefined,
    referenceId: input.invoiceId,
    invoiceIds: input.invoiceId ? [input.invoiceId] : undefined,
    lines: [
      { accountId: bankAccount.id, debit: amount.toFixed(2), credit: "0" },
      { accountId: arAccount.id, debit: "0", credit: amount.toFixed(2) },
    ],
  };

  return insertLedgerEntry(orgId, userId, data);
}
