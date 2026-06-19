"use server";

import { db } from "@/db";
import {
  ledgerAccount, ledgerEntry, ledgerLine, ledgerDocument, ledgerEntryInvoice,
  customer, customerCompany, customerOrganization, supplier, member, invoice, purchaseOrder, user,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { nanoid } from "nanoid";
import { eq, and, desc, asc, inArray, sql, isNull } from "drizzle-orm";
import { deleteLedgerDocFromR2 } from "@/lib/r2/ledger-docs";

// ── Session helper ─────────────────────────────────────────────────────────

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

// ── Types ──────────────────────────────────────────────────────────────────

export type LedgerAccountRow = typeof ledgerAccount.$inferSelect;
export type LedgerEntryRow = typeof ledgerEntry.$inferSelect;
export type LedgerLineRow = typeof ledgerLine.$inferSelect;
export type LedgerDocumentRow = typeof ledgerDocument.$inferSelect;

export type LedgerEntryWithDetails = LedgerEntryRow & {
  lines: LedgerLineRow[];
  documents: LedgerDocumentRow[];
  createdByName: string | null;
  linkedInvoices: { invoiceId: string; invoiceNo: string }[];
};

export type LedgerEntryListRow = LedgerEntryRow & {
  createdByName: string | null;
  lineCount: number;
  docCount: number;
  linkedInvoices: { invoiceId: string; invoiceNo: string }[];
};

export type AccountBalance = LedgerAccountRow & {
  totalDebit: string;
  totalCredit: string;
  balance: string; // net balance (positive = normal side)
};

// ── Entry number generation ────────────────────────────────────────────────

async function generateEntryNo(orgId: string): Promise<string> {
  const year = new Date().getFullYear();
  // count existing entries for this org + year
  const rows = await db
    .select({ entryNo: ledgerEntry.entryNo })
    .from(ledgerEntry)
    .where(and(
      eq(ledgerEntry.organizationId, orgId),
      sql`${ledgerEntry.entryNo} LIKE ${`JE-${year}-%`}`,
    ))
    .orderBy(desc(ledgerEntry.entryNo));

  let next = 1;
  if (rows.length > 0) {
    const last = rows[0].entryNo; // e.g. "JE-2025-0042"
    const parts = last.split("-");
    const num = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(num)) next = num + 1;
  }
  return `JE-${year}-${String(next).padStart(4, "0")}`;
}

// ── Default COA seed list (Malaysian SME — service / trading) ─────────────

type DefaultAccount = {
  code: string;
  name: string;
  type: string;
  subtype: string | null;
  normalBalance: "DEBIT" | "CREDIT";
};

const DEFAULT_ACCOUNTS: DefaultAccount[] = [
  // ASSETS ────────────────────────────────────────────────────────────────
  { code: "1000", name: "Cash on Hand",                                          type: "ASSET",     subtype: "CASH",                    normalBalance: "DEBIT"  },
  { code: "1001", name: "Petty Cash",                                            type: "ASSET",     subtype: "CASH",                    normalBalance: "DEBIT"  },
  { code: "1100", name: "Bank CIMB",                                             type: "ASSET",     subtype: "BANK",                    normalBalance: "DEBIT"  },
  { code: "1200", name: "Accounts Receivable",                                   type: "ASSET",     subtype: "ACCOUNTS_RECEIVABLE",     normalBalance: "DEBIT"  },
  { code: "1300", name: "Due From Member",                                       type: "ASSET",     subtype: "RECEIVABLE",              normalBalance: "DEBIT"  },
  { code: "1400", name: "Prepayments & Deposits",                                type: "ASSET",     subtype: "PREPAYMENT",              normalBalance: "DEBIT"  },
  { code: "1410", name: "Motor Vehicles",                                        type: "ASSET",     subtype: "FIXED_ASSET",             normalBalance: "DEBIT"  },
  { code: "1411", name: "Accumulated Depreciation — Motor Vehicles",             type: "ASSET",     subtype: "ACCUMULATED_DEPRECIATION",normalBalance: "DEBIT"  },
  { code: "1420", name: "Office Equipment",                                      type: "ASSET",     subtype: "FIXED_ASSET",             normalBalance: "DEBIT"  },
  { code: "1421", name: "Accumulated Depreciation — Office Equipment",           type: "ASSET",     subtype: "ACCUMULATED_DEPRECIATION",normalBalance: "DEBIT"  },
  { code: "1430", name: "Furniture & Fittings",                                  type: "ASSET",     subtype: "FIXED_ASSET",             normalBalance: "DEBIT"  },
  { code: "1431", name: "Accumulated Depreciation — Furniture & Fittings",      type: "ASSET",     subtype: "ACCUMULATED_DEPRECIATION",normalBalance: "DEBIT"  },
  { code: "1440", name: "Computer & IT Equipment",                               type: "ASSET",     subtype: "FIXED_ASSET",             normalBalance: "DEBIT"  },
  { code: "1441", name: "Accumulated Depreciation — Computer & IT Equipment",   type: "ASSET",     subtype: "ACCUMULATED_DEPRECIATION",normalBalance: "DEBIT"  },
  { code: "1500", name: "Inventories / Stock",                                   type: "ASSET",     subtype: "INVENTORY",               normalBalance: "DEBIT"  },
  // LIABILITIES ───────────────────────────────────────────────────────────
  { code: "2100", name: "Accounts Payable",                                      type: "LIABILITY", subtype: "ACCOUNTS_PAYABLE",        normalBalance: "CREDIT" },
  { code: "2200", name: "EPF Payable",                                           type: "LIABILITY", subtype: "EPF_PAYABLE",             normalBalance: "CREDIT" },
  { code: "2210", name: "SOCSO Payable",                                         type: "LIABILITY", subtype: "SOCSO_PAYABLE",           normalBalance: "CREDIT" },
  { code: "2220", name: "PCB Payable",                                           type: "LIABILITY", subtype: "PCB_PAYABLE",             normalBalance: "CREDIT" },
  { code: "2230", name: "Income Tax Payable",                                    type: "LIABILITY", subtype: "INCOME_TAX_PAYABLE",      normalBalance: "CREDIT" },
  { code: "2240", name: "Staff Claims Payable",                                  type: "LIABILITY", subtype: "STAFF_CLAIMS_PAYABLE",    normalBalance: "CREDIT" },
  { code: "2250", name: "Salary Payable",                                        type: "LIABILITY", subtype: "SALARY_PAYABLE",          normalBalance: "CREDIT" },
  { code: "2260", name: "Accrued Expenses",                                      type: "LIABILITY", subtype: "ACCRUALS",                normalBalance: "CREDIT" },
  { code: "2300", name: "SST Payable",                                           type: "LIABILITY", subtype: "SST_PAYABLE",             normalBalance: "CREDIT" },
  { code: "2310", name: "Hire Purchase Payable — Motor Vehicles (Current)",      type: "LIABILITY", subtype: "HIRE_PURCHASE_PAYABLE",   normalBalance: "CREDIT" },
  { code: "2410", name: "Hire Purchase Payable — Motor Vehicles (Non-Current)",  type: "LIABILITY", subtype: "HIRE_PURCHASE_PAYABLE",   normalBalance: "CREDIT" },
  // EQUITY ────────────────────────────────────────────────────────────────
  { code: "3100", name: "Share Capital",                                         type: "EQUITY",    subtype: "SHARE_CAPITAL",           normalBalance: "CREDIT" },
  { code: "3200", name: "Retained Earnings",                                     type: "EQUITY",    subtype: "RETAINED_EARNINGS",       normalBalance: "CREDIT" },
  { code: "3900", name: "Opening Balance Equity",                                type: "EQUITY",    subtype: null,                      normalBalance: "CREDIT" },
  // REVENUE ───────────────────────────────────────────────────────────────
  { code: "4000", name: "Sales Revenue",                                         type: "REVENUE",   subtype: "SALES_REVENUE",           normalBalance: "CREDIT" },
  { code: "4100", name: "Service Revenue",                                       type: "REVENUE",   subtype: "SERVICE_REVENUE",         normalBalance: "CREDIT" },
  { code: "4200", name: "Other Income",                                          type: "REVENUE",   subtype: "OTHER_INCOME",            normalBalance: "CREDIT" },
  { code: "4900", name: "Foreign Exchange Gain",                                 type: "REVENUE",   subtype: "FOREX_GAIN",              normalBalance: "CREDIT" },
  // EXPENSES ──────────────────────────────────────────────────────────────
  { code: "5000", name: "Cost of Goods Sold",                                    type: "EXPENSE",   subtype: "COGS",                    normalBalance: "DEBIT"  },
  { code: "5100", name: "Travel & Mileage",                                      type: "EXPENSE",   subtype: "TRAVEL_EXPENSE",          normalBalance: "DEBIT"  },
  { code: "5101", name: "Toll & Parking",                                        type: "EXPENSE",   subtype: "TRAVEL_EXPENSE",          normalBalance: "DEBIT"  },
  { code: "5102", name: "Accommodation",                                         type: "EXPENSE",   subtype: "ACCOMMODATION",           normalBalance: "DEBIT"  },
  { code: "5103", name: "Daily Allowance",                                       type: "EXPENSE",   subtype: null,                      normalBalance: "DEBIT"  },
  { code: "5104", name: "Case Allowance",                                        type: "EXPENSE",   subtype: null,                      normalBalance: "DEBIT"  },
  { code: "5110", name: "Telephone & Communication",                             type: "EXPENSE",   subtype: null,                      normalBalance: "DEBIT"  },
  { code: "5120", name: "Entertainment",                                         type: "EXPENSE",   subtype: "ENTERTAINMENT",           normalBalance: "DEBIT"  },
  { code: "5199", name: "Other Staff Claims",                                    type: "EXPENSE",   subtype: null,                      normalBalance: "DEBIT"  },
  { code: "5200", name: "Overseas Expenses",                                     type: "EXPENSE",   subtype: null,                      normalBalance: "DEBIT"  },
  { code: "5300", name: "Salaries & Wages",                                      type: "EXPENSE",   subtype: "SALARY_EXPENSE",          normalBalance: "DEBIT"  },
  { code: "5301", name: "Director's Remuneration",                               type: "EXPENSE",   subtype: "SALARY_EXPENSE",          normalBalance: "DEBIT"  },
  { code: "5302", name: "EPF Contribution — Employer",                           type: "EXPENSE",   subtype: "EPF_EXPENSE",             normalBalance: "DEBIT"  },
  { code: "5303", name: "SOCSO Contribution — Employer",                         type: "EXPENSE",   subtype: "SOCSO_EXPENSE",           normalBalance: "DEBIT"  },
  { code: "5304", name: "HRD Levy",                                              type: "EXPENSE",   subtype: "HRD_LEVY",                normalBalance: "DEBIT"  },
  { code: "5310", name: "Depreciation — Motor Vehicles",                         type: "EXPENSE",   subtype: "DEPRECIATION",            normalBalance: "DEBIT"  },
  { code: "5320", name: "Vehicle Fuel",                                          type: "EXPENSE",   subtype: "VEHICLE_EXPENSE",         normalBalance: "DEBIT"  },
  { code: "5330", name: "Vehicle Maintenance & Repairs",                         type: "EXPENSE",   subtype: "VEHICLE_EXPENSE",         normalBalance: "DEBIT"  },
  { code: "5340", name: "Vehicle Insurance",                                     type: "EXPENSE",   subtype: "VEHICLE_EXPENSE",         normalBalance: "DEBIT"  },
  { code: "5350", name: "Road Tax & Licensing",                                  type: "EXPENSE",   subtype: "VEHICLE_EXPENSE",         normalBalance: "DEBIT"  },
  { code: "5360", name: "Hire Purchase Interest — Motor Vehicles",               type: "EXPENSE",   subtype: "FINANCE_CHARGE",          normalBalance: "DEBIT"  },
  { code: "5375", name: "Vehicle Rental Expense",                                type: "EXPENSE",   subtype: "OPERATING_LEASE",         normalBalance: "DEBIT"  },
  { code: "5380", name: "Depreciation — Office Equipment",                       type: "EXPENSE",   subtype: "DEPRECIATION",            normalBalance: "DEBIT"  },
  { code: "5390", name: "Depreciation — Furniture & Fittings",                   type: "EXPENSE",   subtype: "DEPRECIATION",            normalBalance: "DEBIT"  },
  { code: "5395", name: "Depreciation — Computer & IT Equipment",                type: "EXPENSE",   subtype: "DEPRECIATION",            normalBalance: "DEBIT"  },
  { code: "5400", name: "Rental — Office Premises",                              type: "EXPENSE",   subtype: "RENTAL_EXPENSE",          normalBalance: "DEBIT"  },
  { code: "5410", name: "Electricity & Water",                                   type: "EXPENSE",   subtype: "UTILITIES",               normalBalance: "DEBIT"  },
  { code: "5420", name: "Internet & Broadband",                                  type: "EXPENSE",   subtype: "UTILITIES",               normalBalance: "DEBIT"  },
  { code: "5430", name: "Office Supplies & Stationery",                          type: "EXPENSE",   subtype: "OFFICE_EXPENSE",          normalBalance: "DEBIT"  },
  { code: "5440", name: "Printing & Reproduction",                               type: "EXPENSE",   subtype: "OFFICE_EXPENSE",          normalBalance: "DEBIT"  },
  { code: "5450", name: "Postage & Courier",                                     type: "EXPENSE",   subtype: "OFFICE_EXPENSE",          normalBalance: "DEBIT"  },
  { code: "5460", name: "Professional Fees",                                     type: "EXPENSE",   subtype: "PROFESSIONAL_FEES",       normalBalance: "DEBIT"  },
  { code: "5470", name: "IT & Software Subscription",                            type: "EXPENSE",   subtype: "IT_EXPENSE",              normalBalance: "DEBIT"  },
  { code: "5480", name: "Group Insurance & Medical",                             type: "EXPENSE",   subtype: "INSURANCE",               normalBalance: "DEBIT"  },
  { code: "5490", name: "Advertising & Promotion",                               type: "EXPENSE",   subtype: "MARKETING",               normalBalance: "DEBIT"  },
  { code: "5500", name: "Staff Training & Development",                          type: "EXPENSE",   subtype: "TRAINING",                normalBalance: "DEBIT"  },
  { code: "5900", name: "Foreign Exchange Loss",                                 type: "EXPENSE",   subtype: "FOREX_LOSS",              normalBalance: "DEBIT"  },
  { code: "5910", name: "Bank Charges — TT/Remittance Fees",                     type: "EXPENSE",   subtype: "BANK_CHARGES",            normalBalance: "DEBIT"  },
  { code: "5920", name: "Bank Charges — Other Fees",                             type: "EXPENSE",   subtype: "BANK_CHARGES",            normalBalance: "DEBIT"  },
  { code: "5960", name: "Income Tax Expense",                                    type: "EXPENSE",   subtype: "INCOME_TAX_EXPENSE",      normalBalance: "DEBIT"  },
  { code: "5990", name: "Miscellaneous Expenses",                                type: "EXPENSE",   subtype: null,                      normalBalance: "DEBIT"  },
];

export async function seedDefaultLedgerAccounts(): Promise<{ inserted: number; skipped: number }> {
  const { orgId } = await requireAccess("account:create");
  const now = new Date();
  const rows = DEFAULT_ACCOUNTS.map((a) => ({
    id: nanoid(),
    organizationId: orgId,
    code: a.code,
    name: a.name,
    type: a.type,
    subtype: a.subtype,
    normalBalance: a.normalBalance,
    description: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }));
  const result = await db
    .insert(ledgerAccount)
    .values(rows)
    .onConflictDoNothing();
  const inserted = result.rowCount ?? 0;
  return { inserted, skipped: rows.length - inserted };
}

// ── Chart of Accounts ──────────────────────────────────────────────────────

export async function getLedgerAccounts(): Promise<LedgerAccountRow[]> {
  const { orgId } = await requireAccess("account:read");
  return db
    .select()
    .from(ledgerAccount)
    .where(eq(ledgerAccount.organizationId, orgId))
    .orderBy(asc(ledgerAccount.code));
}

export async function createLedgerAccount(data: {
  code: string;
  name: string;
  type: string;
  subtype?: string;
  description?: string;
}): Promise<LedgerAccountRow> {
  const { orgId } = await requireAccess("account:create");
  const DEBIT_TYPES = ["ASSET", "EXPENSE"];
  const normalBalance = DEBIT_TYPES.includes(data.type) ? "DEBIT" : "CREDIT";
  const row = {
    id: nanoid(),
    organizationId: orgId,
    code: data.code.trim(),
    name: data.name.trim(),
    type: data.type,
    subtype: data.subtype?.trim() || null,
    normalBalance,
    description: data.description?.trim() || null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.insert(ledgerAccount).values(row);
  return row;
}

export async function updateLedgerAccount(
  id: string,
  data: { name?: string; subtype?: string; description?: string; isActive?: boolean }
): Promise<void> {
  const { orgId } = await requireAccess("account:update");
  await db
    .update(ledgerAccount)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(ledgerAccount.id, id), eq(ledgerAccount.organizationId, orgId)));
}

export async function deleteLedgerAccount(id: string): Promise<void> {
  const { orgId } = await requireAccess("account:delete");
  // Only allow delete if no lines reference this account
  const used = await db
    .select({ id: ledgerLine.id })
    .from(ledgerLine)
    .innerJoin(ledgerEntry, eq(ledgerLine.entryId, ledgerEntry.id))
    .where(and(
      eq(ledgerLine.accountId, id),
      eq(ledgerEntry.organizationId, orgId),
    ))
    .limit(1);
  if (used.length > 0) throw new Error("Account is used in journal entries and cannot be deleted. Deactivate it instead.");
  await db.delete(ledgerAccount).where(and(eq(ledgerAccount.id, id), eq(ledgerAccount.organizationId, orgId)));
}

// ── Journal Entries ────────────────────────────────────────────────────────

export async function getLedgerEntries(): Promise<LedgerEntryListRow[]> {
  const { orgId } = await requireAccess("account:read");
  const entries = await db
    .select({
      entry: ledgerEntry,
      createdByName: user.name,
    })
    .from(ledgerEntry)
    .leftJoin(user, eq(ledgerEntry.createdBy, user.id))
    .where(eq(ledgerEntry.organizationId, orgId))
    .orderBy(desc(ledgerEntry.date), desc(ledgerEntry.entryNo));

  if (entries.length === 0) return [];

  // Get line counts and doc counts
  const entryIds = entries.map((e) => e.entry.id);

  const lineCounts = await db
    .select({ entryId: ledgerLine.entryId, cnt: sql<number>`count(*)::int` })
    .from(ledgerLine)
    .where(inArray(ledgerLine.entryId, entryIds))
    .groupBy(ledgerLine.entryId);

  const docCounts = await db
    .select({ entryId: ledgerDocument.entryId, cnt: sql<number>`count(*)::int` })
    .from(ledgerDocument)
    .where(inArray(ledgerDocument.entryId, entryIds))
    .groupBy(ledgerDocument.entryId);

  const lineMap = Object.fromEntries(lineCounts.map((r) => [r.entryId, r.cnt]));
  const docMap = Object.fromEntries(docCounts.map((r) => [r.entryId, r.cnt]));

  const junctionRows = await db
    .select({ entryId: ledgerEntryInvoice.entryId, invoiceId: ledgerEntryInvoice.invoiceId, invoiceNo: ledgerEntryInvoice.invoiceNo })
    .from(ledgerEntryInvoice)
    .where(inArray(ledgerEntryInvoice.entryId, entryIds));

  const junctionMap = new Map<string, { invoiceId: string; invoiceNo: string }[]>();
  for (const r of junctionRows) {
    const arr = junctionMap.get(r.entryId) ?? [];
    arr.push({ invoiceId: r.invoiceId, invoiceNo: r.invoiceNo });
    junctionMap.set(r.entryId, arr);
  }

  return entries.map(({ entry, createdByName }) => ({
    ...entry,
    createdByName: createdByName ?? null,
    lineCount: lineMap[entry.id] ?? 0,
    docCount: docMap[entry.id] ?? 0,
    linkedInvoices: junctionMap.get(entry.id) ?? [],
  }));
}

export async function getLedgerEntry(id: string): Promise<LedgerEntryWithDetails | null> {
  const { orgId } = await requireAccess("account:read");
  const rows = await db
    .select({ entry: ledgerEntry, createdByName: user.name })
    .from(ledgerEntry)
    .leftJoin(user, eq(ledgerEntry.createdBy, user.id))
    .where(and(eq(ledgerEntry.id, id), eq(ledgerEntry.organizationId, orgId)));
  if (rows.length === 0) return null;
  const { entry, createdByName } = rows[0];
  const [lines, documents, junctionRows] = await Promise.all([
    db.select().from(ledgerLine).where(eq(ledgerLine.entryId, id)).orderBy(asc(ledgerLine.createdAt)),
    db.select().from(ledgerDocument).where(eq(ledgerDocument.entryId, id)).orderBy(asc(ledgerDocument.uploadedAt)),
    db.select({ invoiceId: ledgerEntryInvoice.invoiceId, invoiceNo: ledgerEntryInvoice.invoiceNo })
      .from(ledgerEntryInvoice).where(eq(ledgerEntryInvoice.entryId, id)),
  ]);
  return { ...entry, lines, documents, createdByName: createdByName ?? null, linkedInvoices: junctionRows };
}

export type CreateLedgerEntryInput = {
  date: string;
  description: string;
  transactionType: string;
  referenceType?: string;
  referenceId?: string;
  referenceNo?: string;
  invoiceIds?: string[];
  stakeholderType?: string;
  stakeholderId?: string;
  stakeholderName?: string;
  lines: {
    accountId: string;
    debit: string;
    credit: string;
    description?: string;
    currency?: string;       // foreign currency code, e.g. "USD" — omit for MYR-only lines
    amountForeign?: string;  // original foreign-currency amount
    exchangeRate?: string;   // rate used to derive the MYR debit/credit above
  }[];
};

export async function createLedgerEntry(data: CreateLedgerEntryInput): Promise<string> {
  const { orgId, userId } = await requireAccess("account:create");
  // Validate balance
  const totalDebit = data.lines.reduce((s, l) => s + parseFloat(l.debit || "0"), 0);
  const totalCredit = data.lines.reduce((s, l) => s + parseFloat(l.credit || "0"), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.001) throw new Error("Journal entry is not balanced: debits must equal credits.");

  const entryNo = await generateEntryNo(orgId);
  const entryId = nanoid();

  // Fetch account snapshots
  const accountIds = [...new Set(data.lines.map((l) => l.accountId))];
  const accounts = await db.select().from(ledgerAccount).where(inArray(ledgerAccount.id, accountIds));
  const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a]));

  // neon-http driver has no transaction support — insert sequentially.
  // A DRAFT entry left without lines (if the line insert below ever fails)
  // is harmless: drafts don't affect balances and can be deleted.
  await db.insert(ledgerEntry).values({
    id: entryId,
    organizationId: orgId,
    entryNo,
    date: data.date,
    description: data.description,
    transactionType: data.transactionType,
    referenceType: data.referenceType || "NONE",
    referenceId: data.referenceId || null,
    referenceNo: data.referenceNo || null,
    stakeholderType: data.stakeholderType || "NONE",
    stakeholderId: data.stakeholderId || null,
    stakeholderName: data.stakeholderName || null,
    totalAmount: totalDebit.toFixed(2),
    status: "DRAFT",
    createdBy: userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const lineRows = data.lines.map((l) => ({
    id: nanoid(),
    entryId,
    accountId: l.accountId,
    accountCode: accountMap[l.accountId]?.code ?? "",
    accountName: accountMap[l.accountId]?.name ?? "",
    debit: l.debit || "0",
    credit: l.credit || "0",
    currency: l.currency || null,
    amountForeign: l.amountForeign || null,
    exchangeRate: l.exchangeRate || null,
    description: l.description || null,
    createdAt: new Date(),
  }));
  await db.insert(ledgerLine).values(lineRows);

  if (data.invoiceIds && data.invoiceIds.length > 0) {
    const invoices = await db
      .select({ id: invoice.id, invoiceNo: invoice.invoiceNo })
      .from(invoice)
      .where(inArray(invoice.id, data.invoiceIds));
    const invoiceNoMap = Object.fromEntries(invoices.map((i) => [i.id, i.invoiceNo]));
    await db.insert(ledgerEntryInvoice).values(
      data.invoiceIds.map((invId) => ({
        id: nanoid(),
        entryId,
        invoiceId: invId,
        invoiceNo: invoiceNoMap[invId] ?? "",
      })),
    );
  }

  return entryId;
}

export async function postLedgerEntry(id: string): Promise<void> {
  const { orgId } = await requireAccess("account:update");
  const entry = await db.select().from(ledgerEntry)
    .where(and(eq(ledgerEntry.id, id), eq(ledgerEntry.organizationId, orgId)))
    .limit(1);
  if (!entry[0]) throw new Error("Entry not found");
  if (entry[0].status !== "DRAFT") throw new Error("Only DRAFT entries can be posted");
  await db.update(ledgerEntry).set({ status: "POSTED", postedAt: new Date(), updatedAt: new Date() })
    .where(eq(ledgerEntry.id, id));
}

export type UpdateLedgerEntryMetadataInput = {
  description?: string;
  referenceType?: string;
  referenceId?: string;
  referenceNo?: string;
  invoiceIds?: string[];
  stakeholderType?: string;
  stakeholderId?: string;
  stakeholderName?: string;
};

// Updates descriptive metadata only — never the lines, amounts, or status.
// Allowed regardless of entry status (DRAFT/POSTED/VOID) so a posted entry
// can later be linked to an invoice/PO or tagged to a stakeholder without
// touching the figures that the audit trail depends on.
export async function updateLedgerEntryMetadata(id: string, data: UpdateLedgerEntryMetadataInput): Promise<void> {
  const { orgId } = await requireAccess("account:update");
  const entry = await db.select().from(ledgerEntry)
    .where(and(eq(ledgerEntry.id, id), eq(ledgerEntry.organizationId, orgId)))
    .limit(1);
  if (!entry[0]) throw new Error("Entry not found");

  await db.update(ledgerEntry).set({
    description: data.description?.trim() ?? entry[0].description,
    referenceType: data.referenceType || "NONE",
    referenceId: data.referenceId || null,
    referenceNo: data.referenceNo || null,
    stakeholderType: data.stakeholderType || "NONE",
    stakeholderId: data.stakeholderId || null,
    stakeholderName: data.stakeholderName || null,
    updatedAt: new Date(),
  }).where(eq(ledgerEntry.id, id));

  if (data.invoiceIds !== undefined) {
    await db.delete(ledgerEntryInvoice).where(eq(ledgerEntryInvoice.entryId, id));
    if (data.invoiceIds.length > 0) {
      const invoices = await db
        .select({ id: invoice.id, invoiceNo: invoice.invoiceNo })
        .from(invoice)
        .where(inArray(invoice.id, data.invoiceIds));
      const invoiceNoMap = Object.fromEntries(invoices.map((i) => [i.id, i.invoiceNo]));
      await db.insert(ledgerEntryInvoice).values(
        data.invoiceIds.map((invId) => ({
          id: nanoid(),
          entryId: id,
          invoiceId: invId,
          invoiceNo: invoiceNoMap[invId] ?? "",
        })),
      );
    }
  }
}

export async function voidLedgerEntry(id: string, reason: string): Promise<void> {
  const { orgId } = await requireAccess("account:update");
  const entry = await db.select().from(ledgerEntry)
    .where(and(eq(ledgerEntry.id, id), eq(ledgerEntry.organizationId, orgId)))
    .limit(1);
  if (!entry[0]) throw new Error("Entry not found");
  if (entry[0].status === "VOID") throw new Error("Entry is already voided");
  await db.update(ledgerEntry)
    .set({ status: "VOID", voidReason: reason, updatedAt: new Date() })
    .where(eq(ledgerEntry.id, id));
}

// ── Trial Balance ──────────────────────────────────────────────────────────

export async function getTrialBalance(asOfDate?: string): Promise<AccountBalance[]> {
  const { orgId } = await requireAccess("account:read");
  const accounts = await db.select().from(ledgerAccount)
    .where(eq(ledgerAccount.organizationId, orgId))
    .orderBy(asc(ledgerAccount.code));

  if (accounts.length === 0) return [];
  const accountIds = accounts.map((a) => a.id);

  const lineQuery = db
    .select({
      accountId: ledgerLine.accountId,
      totalDebit: sql<string>`coalesce(sum(${ledgerLine.debit}::numeric), 0)::text`,
      totalCredit: sql<string>`coalesce(sum(${ledgerLine.credit}::numeric), 0)::text`,
    })
    .from(ledgerLine)
    .innerJoin(ledgerEntry, eq(ledgerLine.entryId, ledgerEntry.id))
    .where(and(
      inArray(ledgerLine.accountId, accountIds),
      eq(ledgerEntry.organizationId, orgId),
      eq(ledgerEntry.status, "POSTED"),
      asOfDate ? sql`${ledgerEntry.date} <= ${asOfDate}` : sql`1=1`,
    ))
    .groupBy(ledgerLine.accountId);

  const totals = await lineQuery;
  const totalsMap = Object.fromEntries(totals.map((t) => [t.accountId, t]));

  return accounts.map((acc) => {
    const t = totalsMap[acc.id];
    const debit = parseFloat(t?.totalDebit ?? "0");
    const credit = parseFloat(t?.totalCredit ?? "0");
    const balance = acc.normalBalance === "DEBIT" ? debit - credit : credit - debit;
    return {
      ...acc,
      totalDebit: debit.toFixed(2),
      totalCredit: credit.toFixed(2),
      balance: balance.toFixed(2),
    };
  });
}

// ── Subsidiary Ledger (sub-ledger breakdown by stakeholder) ────────────────
//   The Chart of Accounts only holds one combined total per control account
//   (e.g. "Trade Receivables", "Trade Payables", "Advances to Member"). This
//   breaks that total down per stakeholder, using the stakeholderId tagged on
//   each entry, so you can see who owes how much (debtors) or is owed how
//   much (creditors).

export type SubsidiaryStakeholderType = "CUSTOMER" | "SUPPLIER" | "MEMBER";

export type SubsidiaryLedgerRow = {
  stakeholderId: string;
  stakeholderName: string;
  role: string | null; // only populated for MEMBER
  balance: string; // debit - credit on the selected account, POSTED entries only
};

export async function getSubsidiaryLedger(
  accountId: string,
  stakeholderType: SubsidiaryStakeholderType,
): Promise<SubsidiaryLedgerRow[]> {
  const { orgId } = await requireAccess("account:read");

  const [account] = await db.select().from(ledgerAccount)
    .where(and(eq(ledgerAccount.id, accountId), eq(ledgerAccount.organizationId, orgId)))
    .limit(1);
  if (!account) throw new Error("Account not found");

  const rows = await db
    .select({
      stakeholderId: ledgerEntry.stakeholderId,
      stakeholderName: ledgerEntry.stakeholderName,
      debit: ledgerLine.debit,
      credit: ledgerLine.credit,
    })
    .from(ledgerLine)
    .innerJoin(ledgerEntry, eq(ledgerLine.entryId, ledgerEntry.id))
    .where(and(
      eq(ledgerEntry.organizationId, orgId),
      eq(ledgerEntry.status, "POSTED"),
      eq(ledgerEntry.stakeholderType, stakeholderType),
      eq(ledgerLine.accountId, accountId),
    ));

  const balanceMap = new Map<string, { name: string; balance: number }>();
  for (const r of rows) {
    if (!r.stakeholderId) continue;
    const entry = balanceMap.get(r.stakeholderId) ?? { name: r.stakeholderName ?? "Unknown", balance: 0 };
    entry.balance += parseFloat(r.debit) - parseFloat(r.credit);
    balanceMap.set(r.stakeholderId, entry);
  }

  if (balanceMap.size === 0) return [];

  const stakeholderIds = [...balanceMap.keys()];
  let roleMap: Record<string, string> = {};
  if (stakeholderType === "MEMBER") {
    const members = await db.select({ id: member.id, role: member.role })
      .from(member)
      .where(inArray(member.id, stakeholderIds));
    roleMap = Object.fromEntries(members.map((m) => [m.id, m.role]));
  }

  return [...balanceMap.entries()]
    .map(([stakeholderId, v]) => ({
      stakeholderId,
      stakeholderName: v.name,
      role: stakeholderType === "MEMBER" ? (roleMap[stakeholderId] ?? "member") : null,
      balance: v.balance.toFixed(2),
    }))
    .sort((a, b) => a.stakeholderName.localeCompare(b.stakeholderName));
}

// ── Reference data (for entry form selects) ───────────────────────────────

export async function getLedgerReferenceData() {
  const { orgId } = await requireAccess("account:read");
  const [accounts, customers, suppliers, invoices, purchaseOrders, members] = await Promise.all([
    db.select({ id: ledgerAccount.id, code: ledgerAccount.code, name: ledgerAccount.name, type: ledgerAccount.type, normalBalance: ledgerAccount.normalBalance })
      .from(ledgerAccount)
      .where(and(eq(ledgerAccount.organizationId, orgId), eq(ledgerAccount.isActive, true)))
      .orderBy(asc(ledgerAccount.code)),
    db.select({ id: customer.id, name: customer.name, legacyOrgName: customer.organizationName })
      .from(customer)
      .where(eq(customer.organizationId, orgId))
      .orderBy(asc(customer.name)),
    db.select({ id: supplier.id, name: supplier.name })
      .from(supplier)
      .where(eq(supplier.organizationId, orgId))
      .orderBy(asc(supplier.name)),
    db.select({ id: invoice.id, invoiceNo: invoice.invoiceNo })
      .from(invoice)
      .where(eq(invoice.organizationId, orgId))
      .orderBy(desc(invoice.createdAt))
      .limit(100),
    db.select({ id: purchaseOrder.id, prNo: purchaseOrder.prNo, poNo: purchaseOrder.poNo })
      .from(purchaseOrder)
      .where(eq(purchaseOrder.organizationId, orgId))
      .orderBy(desc(purchaseOrder.createdAt))
      .limit(100),
    // Includes every member regardless of role — owners are members too (member.role = "owner")
    // and must be taggable on transactions just like regular members.
    db.select({ id: member.id, name: user.name, role: member.role })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(and(eq(member.organizationId, orgId), isNull(member.deletedAt)))
      .orderBy(asc(user.name)),
  ]);
  // Enrich customers with their primary company name from customerCompany table.
  // The legacy customer.organizationName column is only populated for old records;
  // newer customers store affiliations in the separate customerCompany table.
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

  return { accounts, customers: enrichedCustomers, suppliers, invoices, purchaseOrders, members };
}

// ── Document record creation (called after R2 upload completes) ────────────

export async function createLedgerDocumentRecord(data: {
  entryId: string;
  fileName: string;
  fileKey: string;
  fileSize: number;
  mimeType: string;
}): Promise<LedgerDocumentRow> {
  const { orgId, userId } = await requireAccess("account:create");
  // Verify entry belongs to org
  const entry = await db.select().from(ledgerEntry)
    .where(and(eq(ledgerEntry.id, data.entryId), eq(ledgerEntry.organizationId, orgId)))
    .limit(1);
  if (!entry[0]) throw new Error("Entry not found");

  const row = {
    id: nanoid(),
    entryId: data.entryId,
    organizationId: orgId,
    fileName: data.fileName,
    fileKey: data.fileKey,
    fileSize: data.fileSize,
    mimeType: data.mimeType,
    uploadedBy: userId,
    uploadedAt: new Date(),
  };
  await db.insert(ledgerDocument).values(row);
  return row;
}

export async function deleteLedgerDocument(id: string): Promise<string> {
  const { orgId } = await requireAccess("account:delete");
  const doc = await db.select().from(ledgerDocument)
    .where(and(eq(ledgerDocument.id, id), eq(ledgerDocument.organizationId, orgId)))
    .limit(1);
  if (!doc[0]) throw new Error("Document not found");
  await db.delete(ledgerDocument).where(eq(ledgerDocument.id, id));
  await deleteLedgerDocFromR2(doc[0].fileKey).catch(() => {});
  return doc[0].fileKey;
}
