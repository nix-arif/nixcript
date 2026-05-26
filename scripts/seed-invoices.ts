/**
 * Step 2 — Seed invoices + case commissions from Excel
 *
 * Column mapping
 * ─────────────────────────────────────────────────────────────────────────────
 * INVOICE NO                 → invoiceNo
 * INVOICE DATE               → invoiceDate   (DD/MM/YY)
 * STATUS                     → status        (Paid→paid, Outstanding→sent, CANCELLED→cancelled)
 * PAYMENT DATE               → paidAt        (DD/MM/YY, only when paid)
 * PAYMENT REF                → paymentRef
 * TOTAL SO                   → grandTotal    (strip commas)
 * COMPANY                    → organizationId
 * LPO                        → customerPoNo
 * SALES ORDER NO             → salesOrderNo
 * INNOSYS BILL TO AFFIRMA    → notes         (cross-reference invoice no.)
 * SURGEON                    → customerId + customerSnapshot (name lookup)
 * HOSPITAL                   → customerSnapshot.organizationName (company lookup)
 * DATE                       → caseDate      (DD/MM/YY)
 * CASE                       → caseType
 * TIME                       → caseTime
 * MRN NO                     → mrnNo
 * SOA Status                 → soaVerified   (✔ = true)
 *
 * caseCommission (created when at least one field is non-null):
 *   ATTEND COMMISSION CLAIM BY → claimedBy
 *   DOCS                       → docs
 *   COMMISSION AMOUNT          → attendAmount
 *   SURGEON COMMISSION         → surgeonAmount
 *   PAYMENT DATE_1             → surgeonPaidAt
 *   Incentive                  → incentive
 *   Actual Amount              → actualAmount
 *
 * Idempotent:
 *   - Skips existing invoices (orgId + invoiceNo match)
 *   - Rebuilds caseCommission for all owned invoices
 *
 * Run:
 *   npx dotenv-cli -e .env -- npx tsx scripts/seed-invoices.ts
 */

import * as XLSX from "xlsx";
import { nanoid } from "nanoid";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { invoice, caseCommission, customer, customerCompany } from "../db/schema";
import { inArray, eq, and } from "drizzle-orm";
import {
  ORG, ALL_ORG_IDS, CREATED_BY, XLSX_FILE,
  resolveOrgId, normalizeSurgeon, normalizeHospital,
  str, toMoney, toDate, mapStatus,
} from "./seed-config";

// ─── Load Excel ───────────────────────────────────────────────────────────────

const wb   = XLSX.readFile(XLSX_FILE);
const ws   = wb.Sheets["Case Detail"];
const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, {
  defval: null,
  raw:    false,
});

// ─── Filter to valid invoice rows ────────────────────────────────────────────

const invoiceRows = rows.filter(r => str(r["INVOICE NO"]));
console.log(`Excel invoice rows: ${invoiceRows.length}`);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function soaVerified(val: unknown): boolean {
  const s = String(val ?? "").trim();
  return s === "✔" || s.toLowerCase() === "yes" || s.toLowerCase() === "verified";
}

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function seed() {
  const db = drizzle({ client: neon(process.env.DATABASE_URL!) });

  // ── Load all customers + companies into memory ────────────────────────────
  const allCustomers = await db
    .select({ id: customer.id, name: customer.name, title: customer.title,
              contactNo: customer.contactNo, email: customer.email })
    .from(customer)
    .where(inArray(customer.organizationId, [...ALL_ORG_IDS]));

  const allCompanies = await db
    .select()
    .from(customerCompany)
    .where(inArray(customerCompany.customerId, allCustomers.map(c => c.id)));

  // name → customer row
  const customerByName = new Map(allCustomers.map(c => [c.name.toLowerCase(), c]));

  // customerId → companies[]
  const companiesByCustomer = new Map<string, typeof allCompanies>();
  for (const co of allCompanies) {
    if (!companiesByCustomer.has(co.customerId)) companiesByCustomer.set(co.customerId, []);
    companiesByCustomer.get(co.customerId)!.push(co);
  }

  console.log(`Loaded ${allCustomers.length} customers, ${allCompanies.length} companies`);

  // ── Find which invoices already exist ────────────────────────────────────
  const existing = await db
    .select({ invoiceNo: invoice.invoiceNo, organizationId: invoice.organizationId })
    .from(invoice)
    .where(inArray(invoice.organizationId, [...ALL_ORG_IDS]));

  const existingSet = new Set(existing.map(e => `${e.organizationId}|${e.invoiceNo}`));
  console.log(`Existing invoices: ${existingSet.size}`);

  // ── Deduplicate: group rows by orgId|invoiceNo ───────────────────────────
  // Some invoices span multiple Excel rows (multi-surgeon, multi-case).
  // Use the FIRST row for invoice-level data; collect all rows for commission.
  type InvoiceRow = typeof invoice.$inferInsert;
  type CommissionRow = typeof caseCommission.$inferInsert;

  // key → first row (invoice data) + all rows (commission merge)
  const grouped = new Map<string, { first: Record<string, unknown>; all: Record<string, unknown>[] }>();
  for (const r of invoiceRows) {
    const invoiceNo = str(r["INVOICE NO"])!;
    const orgId     = resolveOrgId(r["COMPANY"]);
    if (!orgId) continue;
    const key = `${orgId}|${invoiceNo}`;
    if (!grouped.has(key)) grouped.set(key, { first: r, all: [] });
    grouped.get(key)!.all.push(r);
  }

  const toInsert: InvoiceRow[] = [];
  const noCustomer: string[] = [];
  let linkedCount = 0;

  for (const [key, { first: r }] of grouped) {
    const [orgId, invoiceNo] = key.split("|") as [string, string];

    // Skip if already seeded
    if (existingSet.has(key)) continue;

    // ── Customer lookup ───────────────────────────────────────────────────
    let customerId: string | null = null;
    let customerSnapshot: InvoiceRow["customerSnapshot"] = null;

    const surgeonRaw = str(r["SURGEON"]);
    if (surgeonRaw) {
      const { name } = normalizeSurgeon(surgeonRaw);
      const cust = customerByName.get(name.toLowerCase());

      if (cust) {
        customerId = cust.id;
        linkedCount++;

        const hospitalRaw = str(r["HOSPITAL"]);
        const hospital    = hospitalRaw ? normalizeHospital(hospitalRaw) : null;
        const companies   = companiesByCustomer.get(cust.id) ?? [];

        const company = hospital
          ? (companies.find(co => co.organizationName?.toLowerCase() === hospital.toLowerCase())
             ?? companies.find(co => co.isPrimary)
             ?? companies[0])
          : (companies.find(co => co.isPrimary) ?? companies[0]);

        customerSnapshot = {
          title:               cust.title      ?? undefined,
          name:                cust.name,
          email:               cust.email      ?? undefined,
          contactNo:           cust.contactNo  ?? undefined,
          organizationName:    company?.organizationName    ?? undefined,
          organizationAddress: company?.organizationAddress ?? undefined,
        };
      } else {
        noCustomer.push(`${invoiceNo}: "${name}" (raw: "${surgeonRaw}")`);
      }
    }

    // ── Status & payment ──────────────────────────────────────────────────
    const statusRaw = str(r["STATUS"]) ?? "";
    const status    = mapStatus(statusRaw);
    const paidAt    = status === "paid" ? toDate(r["PAYMENT DATE"]) ?? null : null;

    // ── Notes: cross-reference Innosys→Affirma invoice ───────────────────
    const billTo = str(r["INNOSYS BILL TO AFFIRMA"]);
    const notes  = billTo ? `Innosys bill to Affirma: ${billTo}` : null;

    toInsert.push({
      id:               nanoid(),
      organizationId:   orgId,
      invoiceNo,
      invoiceDate:      toDate(r["INVOICE DATE"]) ?? new Date(),
      customerId,
      customerSnapshot,
      customerPoNo:     str(r["LPO"]),
      salesOrderNo:     str(r["SALES ORDER NO"]),
      grandTotal:       toMoney(r["TOTAL SO"]),
      subtotal:         toMoney(r["TOTAL SO"]),
      status,
      paidAt,
      paymentRef:       str(r["PAYMENT REF"]),
      soaVerified:      soaVerified(r["SOA Status"]),
      caseDate:         toDate(r["DATE"]) ?? null,
      caseType:         str(r["CASE"]),
      caseTime:         str(r["TIME"]),
      mrnNo:            str(r["MRN NO"]),
      notes,
      createdBy:        CREATED_BY,
    });
  }

  console.log(`\nTo insert: ${toInsert.length} new invoices`);
  console.log(`Linked to customer: ${linkedCount}`);
  if (noCustomer.length) {
    console.log(`Surgeon not found (${noCustomer.length}):`);
    noCustomer.forEach(s => console.log(`  !! ${s}`));
  }

  // ── Insert invoices in batches ────────────────────────────────────────────
  const BATCH = 50;
  if (toInsert.length > 0) {
    for (let i = 0; i < toInsert.length; i += BATCH) {
      await db.insert(invoice).values(toInsert.slice(i, i + BATCH));
    }
    console.log(`✓ Inserted ${toInsert.length} invoices`);

    // Add to existingSet so commission step can find them
    for (const inv of toInsert) {
      existingSet.add(`${inv.organizationId}|${inv.invoiceNo}`);
    }
  }

  // ── Seed caseCommission ────────────────────────────────────────────────────
  // Re-fetch ALL our invoices to get their IDs (including just-inserted ones)
  const allInvoices = await db
    .select({ id: invoice.id, organizationId: invoice.organizationId, invoiceNo: invoice.invoiceNo })
    .from(invoice)
    .where(inArray(invoice.organizationId, [...ALL_ORG_IDS]));

  // invoiceNo|orgId → invoiceId
  const invoiceIdMap = new Map(allInvoices.map(i => [`${i.organizationId}|${i.invoiceNo}`, i.id]));

  // Delete existing commission rows for all our invoices then re-insert
  const ourInvoiceIds = allInvoices.map(i => i.id);
  console.log(`\nRebuilding commissions for ${ourInvoiceIds.length} invoices…`);

  for (let i = 0; i < ourInvoiceIds.length; i += BATCH) {
    await db.delete(caseCommission)
      .where(inArray(caseCommission.invoiceId, ourInvoiceIds.slice(i, i + BATCH)));
  }

  const commissionRows: CommissionRow[] = [];

  // Commission: merge across all rows for each invoice (first non-null wins)
  for (const [key, { all: rows }] of grouped) {
    const [orgId, invoiceNo] = key.split("|") as [string, string];
    const invoiceId = invoiceIdMap.get(key);
    if (!invoiceId) continue;

    // Pick first non-null value across all rows for each commission field
    const pick = (field: string) => rows.map(r => str(r[field])).find(v => v != null) ?? null;
    const pickMoney = (field: string) => {
      const v = rows.map(r => toMoney(r[field])).find(v => Number(v) > 0);
      return v ?? "0";
    };
    const pickDate = (field: string) => rows.map(r => toDate(r[field])).find(v => v != null) ?? null;

    const claimedBy   = pick("ATTEND COMMISSION CLAIM BY");
    const docs        = pick("DOCS");
    const attendAmt   = pickMoney("COMMISSION AMOUNT");
    const surgeonAmt  = pickMoney("SURGEON COMMISSION");
    const surgeonPaid = pickDate("PAYMENT DATE_1");
    const incentive   = pickMoney("Incentive");
    const actualAmt   = pickMoney("Actual Amount");

    const hasData = claimedBy || docs
      || Number(attendAmt) > 0 || Number(surgeonAmt) > 0
      || surgeonPaid
      || Number(incentive) > 0 || Number(actualAmt) > 0;

    if (!hasData) continue;

    commissionRows.push({
      id:            nanoid(),
      invoiceId,
      organizationId: orgId,
      claimedBy,
      docs,
      attendAmount:  attendAmt,
      surgeonAmount: surgeonAmt,
      surgeonPaidAt: surgeonPaid ?? null,
      incentive,
      actualAmount:  actualAmt,
    });
  }

  if (commissionRows.length > 0) {
    for (let i = 0; i < commissionRows.length; i += BATCH) {
      await db.insert(caseCommission).values(commissionRows.slice(i, i + BATCH));
    }
  }

  console.log(`✓ Inserted ${commissionRows.length} commission rows`);

  // ── Summary ────────────────────────────────────────────────────────────────
  const totalInvoices = await db
    .select({ id: invoice.id })
    .from(invoice)
    .where(inArray(invoice.organizationId, [...ALL_ORG_IDS]));

  console.log(`\n✓ Total invoices in DB : ${totalInvoices.length}`);
  console.log(`✓ Commission rows      : ${commissionRows.length}`);
  console.log("\nDone!");
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
