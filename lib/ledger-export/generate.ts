import { db } from "@/db";
import {
  ledgerAccount, ledgerEntry, ledgerLine, ledgerDocument, ledgerEntryInvoice,
  invoice, invoiceItem, invoiceExpense, organizationProfile,
} from "@/db/schema";
import { eq, and, asc, inArray, sql, or } from "drizzle-orm";
import * as XLSX from "xlsx";
import { zipSync } from "fflate";
import { getLedgerDocBytes } from "@/lib/r2/ledger-docs";
import { generateInvoicePdf } from "./invoice-pdf";

export type LedgerExportOptions = {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  includeAttachments: boolean;
};

const TX_LABELS: Record<string, string> = {
  CAPITAL_INVESTMENT: "Capital Investment",
  SUPPLIER_PAYMENT: "Supplier Payment",
  CUSTOMER_PAYMENT: "Customer Payment",
  REVENUE_RECOGNITION: "Revenue Recognition",
  PURCHASE: "Purchase",
  PAYROLL: "Payroll",
  STATUTORY_PAYMENT: "Statutory Payment",
  TAX_PAYMENT: "Tax Payment",
  GENERAL_EXPENSE: "General Expense",
  JOURNAL_ADJUSTMENT: "Journal Adjustment",
};

export async function generateLedgerExportZip(
  orgId: string,
  opts: LedgerExportOptions,
): Promise<Uint8Array> {
  const { from, to, includeAttachments } = opts;

  // ── Fetch data ─────────────────────────────────────────────────────────────

  const accounts = await db
    .select()
    .from(ledgerAccount)
    .where(eq(ledgerAccount.organizationId, orgId))
    .orderBy(asc(ledgerAccount.code));

  const entries = await db
    .select()
    .from(ledgerEntry)
    .where(
      and(
        eq(ledgerEntry.organizationId, orgId),
        sql`${ledgerEntry.date} >= ${from}`,
        sql`${ledgerEntry.date} <= ${to}`,
      ),
    )
    .orderBy(asc(ledgerEntry.date), asc(ledgerEntry.entryNo));

  const entryIds = entries.map((e) => e.id);

  const [lines, docs] = await Promise.all([
    entryIds.length
      ? db.select().from(ledgerLine).where(inArray(ledgerLine.entryId, entryIds)).orderBy(asc(ledgerLine.createdAt))
      : Promise.resolve([] as (typeof ledgerLine.$inferSelect)[]),
    entryIds.length
      ? db.select().from(ledgerDocument).where(inArray(ledgerDocument.entryId, entryIds))
      : Promise.resolve([] as (typeof ledgerDocument.$inferSelect)[]),
  ]);

  // Trial balance: cumulative as of `to` (all posted entries up to and including `to`)
  const accountIds = accounts.map((a) => a.id);
  const tbTotals = accountIds.length
    ? await db
        .select({
          accountId: ledgerLine.accountId,
          totalDebit: sql<string>`coalesce(sum(${ledgerLine.debit}::numeric), 0)::text`,
          totalCredit: sql<string>`coalesce(sum(${ledgerLine.credit}::numeric), 0)::text`,
        })
        .from(ledgerLine)
        .innerJoin(ledgerEntry, eq(ledgerLine.entryId, ledgerEntry.id))
        .where(
          and(
            inArray(ledgerLine.accountId, accountIds),
            eq(ledgerEntry.organizationId, orgId),
            eq(ledgerEntry.status, "POSTED"),
            sql`${ledgerEntry.date} <= ${to}`,
          ),
        )
        .groupBy(ledgerLine.accountId)
    : [];
  const tbMap = Object.fromEntries(tbTotals.map((t) => [t.accountId, t]));

  // Subsidiary ledger: cumulative as of `to`, posted entries with stakeholders
  const subRows = accountIds.length
    ? await db
        .select({
          accountId: ledgerLine.accountId,
          stakeholderId: ledgerEntry.stakeholderId,
          stakeholderName: ledgerEntry.stakeholderName,
          stakeholderType: ledgerEntry.stakeholderType,
          debit: ledgerLine.debit,
          credit: ledgerLine.credit,
        })
        .from(ledgerLine)
        .innerJoin(ledgerEntry, eq(ledgerLine.entryId, ledgerEntry.id))
        .where(
          and(
            eq(ledgerEntry.organizationId, orgId),
            eq(ledgerEntry.status, "POSTED"),
            sql`${ledgerEntry.stakeholderType} <> 'NONE'`,
            sql`${ledgerEntry.date} <= ${to}`,
          ),
        )
    : [];

  // ── Build indexes ──────────────────────────────────────────────────────────

  const entryById = new Map(entries.map((e) => [e.id, e]));

  const linesPerEntry: Record<string, typeof lines> = {};
  for (const l of lines) {
    if (!linesPerEntry[l.entryId]) linesPerEntry[l.entryId] = [];
    linesPerEntry[l.entryId].push(l);
  }

  const docsPerEntry: Record<string, number> = {};
  for (const d of docs) docsPerEntry[d.entryId] = (docsPerEntry[d.entryId] ?? 0) + 1;

  // ── Excel workbook ─────────────────────────────────────────────────────────

  const wb = XLSX.utils.book_new();

  // Sheet 1: Journal Entries
  const jeRows: (string | number)[][] = [
    ["Entry No", "Date", "Transaction Type", "Status", "Description", "Stakeholder", "Reference No", "Debit Total (MYR)", "Credit Total (MYR)", "Lines", "Attached Docs"],
  ];
  for (const e of entries) {
    const ls = linesPerEntry[e.id] ?? [];
    jeRows.push([
      e.entryNo,
      e.date ?? "",
      TX_LABELS[e.transactionType] ?? e.transactionType,
      e.status,
      e.description,
      e.stakeholderName ?? "",
      e.referenceNo ?? "",
      ls.reduce((s, l) => s + parseFloat(l.debit || "0"), 0).toFixed(2),
      ls.reduce((s, l) => s + parseFloat(l.credit || "0"), 0).toFixed(2),
      ls.length,
      docsPerEntry[e.id] ?? 0,
    ]);
  }
  const wsJe = XLSX.utils.aoa_to_sheet(jeRows);
  wsJe["!cols"] = [14, 12, 22, 8, 44, 30, 18, 18, 18, 6, 12].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, wsJe, "Journal Entries");

  // Sheet 2: Journal Lines
  const jlRows: (string | number)[][] = [
    ["Entry No", "Date", "Account Code", "Account Name", "Debit (MYR)", "Credit (MYR)", "Currency", "Foreign Amount", "Exchange Rate", "Note"],
  ];
  for (const l of lines) {
    const e = entryById.get(l.entryId);
    jlRows.push([
      e?.entryNo ?? "",
      e?.date ?? "",
      l.accountCode,
      l.accountName,
      l.debit && l.debit !== "0" ? parseFloat(l.debit) : "",
      l.credit && l.credit !== "0" ? parseFloat(l.credit) : "",
      l.currency ?? "",
      l.amountForeign ? parseFloat(l.amountForeign) : "",
      l.exchangeRate ? parseFloat(l.exchangeRate) : "",
      l.description ?? "",
    ]);
  }
  const wsJl = XLSX.utils.aoa_to_sheet(jlRows);
  wsJl["!cols"] = [14, 12, 14, 34, 14, 14, 10, 14, 14, 40].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, wsJl, "Journal Lines");

  // Sheet 3: Trial Balance
  let totalD = 0;
  let totalC = 0;
  const tbRows: (string | number)[][] = [
    [`Trial Balance — As of ${to}`],
    [],
    ["Code", "Account Name", "Type", "Normal Balance", "Debit (MYR)", "Credit (MYR)", "Net Balance (MYR)"],
  ];
  for (const acc of accounts) {
    const t = tbMap[acc.id];
    const d = parseFloat(t?.totalDebit ?? "0");
    const c = parseFloat(t?.totalCredit ?? "0");
    const bal = acc.normalBalance === "DEBIT" ? d - c : c - d;
    totalD += d;
    totalC += c;
    tbRows.push([acc.code, acc.name, acc.type, acc.normalBalance, d || "", c || "", bal.toFixed(2)]);
  }
  tbRows.push([], ["", "", "", "TOTALS", totalD.toFixed(2), totalC.toFixed(2), ""]);
  const wsTb = XLSX.utils.aoa_to_sheet(tbRows);
  wsTb["!cols"] = [8, 36, 12, 16, 14, 14, 16].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, wsTb, "Trial Balance");

  // Sheet 4: Subsidiary Ledger
  type SubKey = string;
  const subMap = new Map<SubKey, Map<string, { name: string; balance: number }>>();
  for (const r of subRows) {
    if (!r.stakeholderId || !r.stakeholderType) continue;
    const key: SubKey = `${r.accountId}|${r.stakeholderType}`;
    if (!subMap.has(key)) subMap.set(key, new Map());
    const stMap = subMap.get(key)!;
    const prev = stMap.get(r.stakeholderId) ?? { name: r.stakeholderName ?? "Unknown", balance: 0 };
    prev.balance += parseFloat(r.debit) - parseFloat(r.credit);
    stMap.set(r.stakeholderId, prev);
  }

  if (subMap.size > 0) {
    const slRows: (string | number)[][] = [
      [`Subsidiary Ledger — As of ${to}`],
      [],
      ["Account Code", "Account Name", "Stakeholder Type", "Stakeholder Name", "Net Balance (MYR)"],
    ];
    for (const [key, stMap] of subMap.entries()) {
      const [accountId, stakeholderType] = key.split("|");
      const acc = accounts.find((a) => a.id === accountId);
      for (const [, v] of stMap.entries()) {
        slRows.push([acc?.code ?? "", acc?.name ?? "", stakeholderType, v.name, parseFloat(v.balance.toFixed(2))]);
      }
    }
    const wsSl = XLSX.utils.aoa_to_sheet(slRows);
    wsSl["!cols"] = [10, 36, 18, 36, 18].map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, wsSl, "Subsidiary Ledger");
  }

  // ── Write workbook + build ZIP ─────────────────────────────────────────────

  const xlsxBuf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
  const zipFiles: { [path: string]: Uint8Array } = {};
  zipFiles[`Ledger_Export_${from}_to_${to}.xlsx`] = new Uint8Array(xlsxBuf);

  if (includeAttachments && docs.length > 0) {
    const entryNoMap = Object.fromEntries(entries.map((e) => [e.id, e.entryNo]));
    const results = await Promise.allSettled(
      docs.map(async (doc) => {
        const bytes = await getLedgerDocBytes(doc.fileKey);
        const entryNo = entryNoMap[doc.entryId] ?? doc.entryId;
        const safeName = doc.fileName.replace(/[^a-zA-Z0-9._\-]/g, "_");
        return { path: `docs/${entryNo}_${safeName}`, bytes };
      }),
    );
    for (const r of results) {
      if (r.status === "fulfilled") zipFiles[r.value.path] = r.value.bytes;
    }
  }

  // ── Linked invoices ────────────────────────────────────────────────────────

  // Collect all invoice IDs referenced in this export's entries
  const junctionRows = entryIds.length
    ? await db
        .select({ invoiceId: ledgerEntryInvoice.invoiceId })
        .from(ledgerEntryInvoice)
        .where(inArray(ledgerEntryInvoice.entryId, entryIds))
    : [];

  const invoiceIdsFromJunction = junctionRows.map((r) => r.invoiceId);
  const invoiceIdsFromRef = entries
    .filter((e) => e.referenceType === "INVOICE" && e.referenceId)
    .map((e) => e.referenceId as string);

  const allInvoiceIds = [...new Set([...invoiceIdsFromJunction, ...invoiceIdsFromRef])];

  if (allInvoiceIds.length > 0) {
    const [invoiceHeaders, invoiceItems, invoiceExpenses, orgProfiles] = await Promise.all([
      db.select().from(invoice).where(inArray(invoice.id, allInvoiceIds)),
      db.select().from(invoiceItem).where(inArray(invoiceItem.invoiceId, allInvoiceIds)).orderBy(asc(invoiceItem.rowNo)),
      db.select().from(invoiceExpense).where(inArray(invoiceExpense.invoiceId, allInvoiceIds)).orderBy(asc(invoiceExpense.createdAt)),
      db.select({
        companyName: organizationProfile.companyName,
        companyAddress: organizationProfile.companyAddress,
        taxNo: organizationProfile.taxNo,
        brandColor: organizationProfile.brandColor,
        phone: organizationProfile.phone,
        email: organizationProfile.email,
        website: organizationProfile.website,
        oldSsmNo: organizationProfile.oldSsmNo,
        newSsmNo: organizationProfile.newSsmNo,
        mdaEstablishmentNo: organizationProfile.mdaEstablishmentNo,
        mofNo: organizationProfile.mofNo,
        headerLayout: organizationProfile.headerLayout,
        orgNameSize: organizationProfile.orgNameSize,
        orgNameBold: organizationProfile.orgNameBold,
        orgNameUppercase: organizationProfile.orgNameUppercase,
      }).from(organizationProfile).where(eq(organizationProfile.organizationId, orgId)).limit(1),
    ]);

    const orgProfile = orgProfiles[0] ?? {
      companyName: null, companyAddress: null, taxNo: null,
      brandColor: null, phone: null, email: null, website: null,
      oldSsmNo: null, newSsmNo: null, mdaEstablishmentNo: null, mofNo: null,
      headerLayout: null, orgNameSize: null, orgNameBold: null, orgNameUppercase: null,
    };
    const org = {
      companyName:        orgProfile.companyName ?? "Company",
      companyAddress:     orgProfile.companyAddress ?? null,
      taxNo:              orgProfile.taxNo ?? null,
      brandColor:         orgProfile.brandColor ?? null,
      phone:              orgProfile.phone ?? null,
      email:              orgProfile.email ?? null,
      website:            orgProfile.website ?? null,
      oldSsmNo:           orgProfile.oldSsmNo ?? null,
      newSsmNo:           orgProfile.newSsmNo ?? null,
      mdaEstablishmentNo: orgProfile.mdaEstablishmentNo ?? null,
      mofNo:              orgProfile.mofNo ?? null,
      headerLayout:       orgProfile.headerLayout ?? null,
      orgNameSize:        orgProfile.orgNameSize ?? null,
      orgNameBold:        orgProfile.orgNameBold ?? null,
      orgNameUppercase:   orgProfile.orgNameUppercase ?? null,
    };

    const itemsByInvoice = new Map<string, typeof invoiceItems>();
    for (const item of invoiceItems) {
      const arr = itemsByInvoice.get(item.invoiceId) ?? [];
      arr.push(item);
      itemsByInvoice.set(item.invoiceId, arr);
    }

    const expensesByInvoice = new Map<string, typeof invoiceExpenses>();
    for (const exp of invoiceExpenses) {
      const arr = expensesByInvoice.get(exp.invoiceId) ?? [];
      arr.push(exp);
      expensesByInvoice.set(exp.invoiceId, arr);
    }

    const pdfResults = await Promise.allSettled(
      invoiceHeaders.map(async (inv) => {
        const snap = inv.customerSnapshot as {
          title?: string; name?: string; organizationName?: string;
          organizationAddress?: string; email?: string; contactNo?: string;
        } | null;
        const pdfBytes = await generateInvoicePdf(
          {
            invoiceNo: inv.invoiceNo,
            invoiceDate: inv.invoiceDate,
            dueDate: inv.dueDate,
            status: inv.status,
            notes: inv.notes,
            subtotal: inv.subtotal,
            overallDiscountAmt: inv.overallDiscountAmt,
            sstPct: inv.sstPct,
            sst: inv.sst,
            grandTotal: inv.grandTotal,
            customerSnapshot: snap,
            items: itemsByInvoice.get(inv.id) ?? [],
            expenses: expensesByInvoice.get(inv.id) ?? [],
          },
          org,
        );
        const safeName = inv.invoiceNo.replace(/[^a-zA-Z0-9._\-]/g, "_");
        return { path: `invoices/${safeName}.pdf`, bytes: pdfBytes };
      }),
    );

    for (const r of pdfResults) {
      if (r.status === "fulfilled") zipFiles[r.value.path] = r.value.bytes;
    }
  }

  return zipSync(zipFiles);
}
