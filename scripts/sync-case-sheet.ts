/**
 * Sync customers + invoices + case commissions + delivery orders + document
 * categories from the live "Case Detail" Google Sheet — supersedes the old
 * scripts/seed-customers.ts + seed-invoices.ts (which required a manual
 * Excel export) by reading straight from the Sheets API. Reuses the exact
 * same normalization rules from seed-config.ts.
 *
 * Sheet: https://docs.google.com/spreadsheets/d/1q4-AlIajvMSloO_4dsnerTaKU-Yy1GrgeXqlLsq_AIA
 * Tab:   "Case Detail" (gid 862547153)
 *
 * Column drift vs. the original scripts (verified 2026-09-09):
 *   - "Sales Person" header is now blank — data is still there, at column
 *     index 7 by position. Positional fallback below.
 *   - "SOA Status" and "Incentive" columns no longer exist — gracefully
 *     default to false/"0", same as the original scripts already did for
 *     any missing column.
 *   - A few rows have a blank COMPANY cell — company is inferred from the
 *     invoice number prefix (INVAF→Affirma, INVSI→Innosys) as a fallback.
 *
 * Steps (idempotent, safe to re-run):
 *   1. Seed/refresh customers (surgeons) + hospital affiliations — the step
 *      the first run of this sync skipped, which is why 43 new invoices
 *      landed with no linked customer.
 *   2. Sync invoices: insert any (orgId, invoiceNo) not already in the DB.
 *   3. Backfill customerId on any EXISTING invoice that's still unlinked,
 *      now that step 1 may have just created the matching customer.
 *   4. Rebuild case_commission for every invoice (old + new).
 *   5. Assign document categories to every invoice: "private" + "laser"
 *      always, plus a case-type category derived from the CASE column
 *      (evlt / milh / pldd / rfa / silac / filac — "fistula" in the sheet
 *      maps to the "filac" category; "PLDD & RFA" gets both). Categories
 *      are org-scoped rows that already exist in document_category for
 *      both Affirma and Innosys — nothing new is created here.
 *   6. Rebuild delivery_order from the invoice table, copying each
 *      invoice's own categoryIds onto its DO — exactly like the old
 *      seed-delivery-orders.ts, scoped to ALL_ORG_IDS. Verified safe: every
 *      existing DO for these two orgs already follows this same DOAF/DOSI
 *      derivation, there's no unrelated real DO data in these orgs to lose.
 *
 * Run:
 *   npx dotenv-cli -e .env -- npx tsx scripts/sync-case-sheet.ts
 */

import { createSign } from "crypto";
import { nanoid } from "nanoid";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { inArray, eq, and, isNotNull } from "drizzle-orm";
import {
  invoice, caseCommission, customer, customerCompany, customerOrganization,
  deliveryOrder, deliveryOrderItem, documentCategory,
} from "../db/schema";
import {
  ORG, ALL_ORG_IDS, CREATED_BY, resolveOrgId,
  normalizeSurgeon, normalizeHospital, str, toMoney, toDate, mapStatus,
} from "./seed-config";

const SHEET_ID = "1q4-AlIajvMSloO_4dsnerTaKU-Yy1GrgeXqlLsq_AIA";
const TAB_NAME = "Case Detail";

// ─── Google Sheets read (service account JWT, matching lib/google-sheets.ts) ──

function cleanPrivateKey(raw: string): string {
  return raw.trim().replace(/^"/, "").replace(/",?$/, "").replace(/\\n/g, "\n");
}

async function getAccessToken(email: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  })).toString("base64url");
  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(privateKey, "base64url");
  const jwt = `${header}.${payload}.${signature}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Google auth failed: ${data.error_description ?? JSON.stringify(data)}`);
  return data.access_token;
}

async function fetchSheetRows(): Promise<Record<string, string>[]> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!;
  const key = cleanPrivateKey(process.env.GOOGLE_PRIVATE_KEY!);
  const token = await getAccessToken(email, key);

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/'${TAB_NAME}'!A1:BA1000`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`Sheets API error: ${JSON.stringify(data)}`);
  const rows: string[][] = data.values ?? [];
  const headers = rows[0] ?? [];

  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { if (h) obj[h] = r[i] ?? ""; });
    if (!obj["Sales Person"] && r[7]) obj["Sales Person"] = r[7];
    return obj;
  });
}

function resolveOrgIdWithFallback(company: unknown, invoiceNo: string): string | null {
  const direct = resolveOrgId(company);
  if (direct) return direct;
  if (/^INVAF\//i.test(invoiceNo)) return ORG.affirma;
  if (/^INVSI\//i.test(invoiceNo)) return ORG.innosys;
  return null;
}

function soaVerified(val: unknown): boolean {
  const s = String(val ?? "").trim();
  return s === "✔" || s.toLowerCase() === "yes" || s.toLowerCase() === "verified";
}

function invoiceNoToDoNo(invoiceNo: string): string {
  return invoiceNo.replace(/^INV/, "DO");
}

function mapDoStatus(invoiceStatus: string): string {
  switch (invoiceStatus) {
    case "paid":
    case "sent":
    case "overdue": return "delivered";
    case "cancelled": return "returned";
    default: return "draft";
  }
}

// "PLDD & RFA" → ["pldd", "rfa"]; "FISTULA" (the word the sheet actually
// uses) → ["filac"], the category's real name in document_category.
function caseTypeToCategoryNames(caseType: string | null | undefined): string[] {
  if (!caseType) return [];
  const parts = caseType.toUpperCase().split(/[&,/]+/).map((p) => p.trim()).filter(Boolean);
  const names: string[] = [];
  for (const part of parts) {
    if (part === "EVLT") names.push("evlt");
    else if (part === "MILH") names.push("milh");
    else if (part === "PLDD") names.push("pldd");
    else if (part === "RFA") names.push("rfa");
    else if (part === "FISTULA" || part === "FILAC") names.push("filac");
    else if (part === "SILAC") names.push("silac");
  }
  return [...new Set(names)];
}

async function main() {
  console.log("Fetching live sheet data...");
  const allRows = await fetchSheetRows();
  const invoiceRows = allRows.filter((r) => str(r["INVOICE NO"]));
  console.log(`Sheet rows with an INVOICE NO: ${invoiceRows.length}`);

  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle({ client: sql });

  // ── Step 1: seed/refresh customers + hospital affiliations ───────────────
  console.log("\n=== Step 1: customers ===");
  type HospitalEntry = { name: string; count: number };
  type CustomerEntry = {
    orgCounts: Map<string, number>;
    title: string | null;
    name: string;
    hospitals: Map<string, HospitalEntry>;
    contactNo: string | null;
  };
  const customerMap = new Map<string, CustomerEntry>();

  for (const r of invoiceRows) {
    const surgeonRaw = str(r["SURGEON"]);
    const hospitalRaw = str(r["HOSPITAL"]);
    const contactRaw = str(r["CONTACT NO"]);
    const orgId = resolveOrgIdWithFallback(r["COMPANY"], str(r["INVOICE NO"])!);
    if (!surgeonRaw || !hospitalRaw || !orgId) continue;

    const { title, name } = normalizeSurgeon(surgeonRaw);
    const hospital = normalizeHospital(hospitalRaw);

    if (!customerMap.has(name)) {
      customerMap.set(name, { orgCounts: new Map(), title, name, hospitals: new Map(), contactNo: null });
    }
    const entry = customerMap.get(name)!;
    entry.orgCounts.set(orgId, (entry.orgCounts.get(orgId) ?? 0) + 1);
    const h = entry.hospitals.get(hospital);
    if (h) h.count++; else entry.hospitals.set(hospital, { name: hospital, count: 1 });
    if (!entry.contactNo && contactRaw) entry.contactNo = contactRaw;
  }

  function primaryOrgId(entry: CustomerEntry): string {
    let max = 0, best: string = ORG.affirma;
    for (const [orgId, count] of entry.orgCounts) if (count > max) { max = count; best = orgId; }
    return best;
  }
  function primaryHospital(entry: CustomerEntry): string {
    let max = 0, primary = "";
    for (const h of entry.hospitals.values()) if (h.count > max) { max = h.count; primary = h.name; }
    return primary;
  }

  const existingCustomers = await db
    .select({ id: customer.id, name: customer.name, organizationId: customer.organizationId })
    .from(customer)
    .where(inArray(customer.organizationId, [...ALL_ORG_IDS]));
  const customerIdByName = new Map(existingCustomers.map((c) => [c.name, c.id]));
  const customerOrgById = new Map(existingCustomers.map((c) => [c.id, c.organizationId]));
  console.log(`Existing customers: ${existingCustomers.length}`);

  const newCustomers = [...customerMap.values()].filter((c) => !customerIdByName.has(c.name));
  if (newCustomers.length > 0) {
    const rows = newCustomers.map((c) => ({
      id: nanoid(), organizationId: primaryOrgId(c), title: c.title, name: c.name,
      organizationName: primaryHospital(c), contactNo: c.contactNo, createdBy: CREATED_BY,
    }));
    for (let i = 0; i < rows.length; i += 50) await db.insert(customer).values(rows.slice(i, i + 50));
    for (const r of rows) { customerIdByName.set(r.name, r.id); customerOrgById.set(r.id, r.organizationId); }
    console.log(`✓ Inserted ${newCustomers.length} new customers`);
  } else {
    console.log("No new customers.");
  }

  // customerCompany doesn't carry a plain hospital-name column — it links to
  // customer_organization (org-scoped, unique on (organizationId, name)) via
  // customerOrganizationId. Find-or-create one per (customer's own org,
  // hospital name) — matches the dominant existing convention (~86% of
  // pre-existing rows scope the hospital to the customer's own org).
  const existingCustomerOrgs = await db
    .select({ id: customerOrganization.id, organizationId: customerOrganization.organizationId, name: customerOrganization.name })
    .from(customerOrganization)
    .where(inArray(customerOrganization.organizationId, [...ALL_ORG_IDS]));
  const custOrgIdByKey = new Map(existingCustomerOrgs.map((o) => [`${o.organizationId}|${o.name.toLowerCase()}`, o.id]));

  async function findOrCreateCustomerOrg(orgId: string, hospitalName: string): Promise<string> {
    const key = `${orgId}|${hospitalName.toLowerCase()}`;
    const found = custOrgIdByKey.get(key);
    if (found) return found;
    const id = nanoid();
    await db.insert(customerOrganization).values({ id, organizationId: orgId, name: hospitalName });
    custOrgIdByKey.set(key, id);
    return id;
  }

  // Rebuild hospital affiliations for every surgeon we manage (idempotent)
  const ourCustomerIds = [...customerMap.values()].map((c) => customerIdByName.get(c.name)).filter((id): id is string => !!id);
  for (let i = 0; i < ourCustomerIds.length; i += 50) {
    await db.delete(customerCompany).where(inArray(customerCompany.customerId, ourCustomerIds.slice(i, i + 50)));
  }
  const companyRows: { id: string; customerId: string; customerOrganizationId: string; isPrimary: boolean }[] = [];
  for (const entry of customerMap.values()) {
    const customerId = customerIdByName.get(entry.name);
    if (!customerId) continue;
    const homeOrgId = customerOrgById.get(customerId) ?? primaryOrgId(entry);
    const sorted = [...entry.hospitals.values()].sort((a, b) => b.count - a.count);
    for (let idx = 0; idx < sorted.length; idx++) {
      const customerOrganizationId = await findOrCreateCustomerOrg(homeOrgId, sorted[idx].name);
      companyRows.push({ id: nanoid(), customerId, customerOrganizationId, isPrimary: idx === 0 });
    }
  }
  for (let i = 0; i < companyRows.length; i += 50) await db.insert(customerCompany).values(companyRows.slice(i, i + 50));
  console.log(`✓ Rebuilt ${companyRows.length} hospital affiliation rows for ${ourCustomerIds.length} customers (${custOrgIdByKey.size} distinct hospital orgs)`);

  // ── Step 2: sync invoices ─────────────────────────────────────────────────
  console.log("\n=== Step 2: invoices ===");
  const allCompanies = await db
    .select({
      id: customerCompany.id, customerId: customerCompany.customerId,
      organizationName: customerOrganization.name, organizationAddress: customerOrganization.address,
      isPrimary: customerCompany.isPrimary,
    })
    .from(customerCompany)
    .leftJoin(customerOrganization, eq(customerOrganization.id, customerCompany.customerOrganizationId))
    .where(inArray(customerCompany.customerId, ourCustomerIds));
  const companiesByCustomer = new Map<string, typeof allCompanies>();
  for (const co of allCompanies) {
    if (!companiesByCustomer.has(co.customerId)) companiesByCustomer.set(co.customerId, []);
    companiesByCustomer.get(co.customerId)!.push(co);
  }
  const customerById = new Map(
    (await db.select({ id: customer.id, name: customer.name, title: customer.title, contactNo: customer.contactNo, email: customer.email })
      .from(customer).where(inArray(customer.organizationId, [...ALL_ORG_IDS])))
      .map((c) => [c.id, c]),
  );

  const existingInvoices = await db
    .select({ invoiceNo: invoice.invoiceNo, organizationId: invoice.organizationId })
    .from(invoice)
    .where(inArray(invoice.organizationId, [...ALL_ORG_IDS]));
  const existingSet = new Set(existingInvoices.map((e) => `${e.organizationId}|${e.invoiceNo}`));
  console.log(`Existing invoices: ${existingSet.size}`);

  type InvoiceRow = typeof invoice.$inferInsert;
  const grouped = new Map<string, { first: Record<string, string>; all: Record<string, string>[] }>();
  for (const r of invoiceRows) {
    const invoiceNo = str(r["INVOICE NO"])!;
    const orgId = resolveOrgIdWithFallback(r["COMPANY"], invoiceNo);
    if (!orgId) continue;
    const key = `${orgId}|${invoiceNo}`;
    if (!grouped.has(key)) grouped.set(key, { first: r, all: [] });
    grouped.get(key)!.all.push(r);
  }

  // hospitalHint: the specific hospital named on THIS row/invoice, if any —
  // matched against the customer's company list first; falls back to their
  // primary hospital when there's no hint or no match. Same logic the main
  // invoice-creation loop below uses, extracted so the backfill and repair
  // steps build an identically-correct snapshot instead of a cruder
  // primary-only guess.
  function snapshotFor(customerId: string, hospitalHint?: string | null) {
    const cust = customerById.get(customerId);
    if (!cust) return null;
    const companies = companiesByCustomer.get(customerId) ?? [];
    const hospital = hospitalHint ? normalizeHospital(hospitalHint) : null;
    const company = hospital
      ? (companies.find((co) => co.organizationName?.toLowerCase() === hospital.toLowerCase()) ?? companies.find((co) => co.isPrimary) ?? companies[0])
      : (companies.find((co) => co.isPrimary) ?? companies[0]);
    return {
      title: cust.title ?? undefined, name: cust.name, email: cust.email ?? undefined, contactNo: cust.contactNo ?? undefined,
      organizationName: company?.organizationName ?? undefined, organizationAddress: company?.organizationAddress ?? undefined,
    };
  }

  const toInsert: InvoiceRow[] = [];
  const noCustomer: string[] = [];
  let linkedCount = 0;

  for (const [key, { first: r }] of grouped) {
    const [orgId, invoiceNo] = key.split("|") as [string, string];
    if (existingSet.has(key)) continue;

    let customerId: string | null = null;
    let customerSnapshot: InvoiceRow["customerSnapshot"] = null;
    const surgeonRaw = str(r["SURGEON"]);
    if (surgeonRaw) {
      const { name } = normalizeSurgeon(surgeonRaw);
      const custId = customerIdByName.get(name);
      if (custId) {
        customerId = custId;
        linkedCount++;
        customerSnapshot = snapshotFor(custId, str(r["HOSPITAL"]));
      } else {
        noCustomer.push(`${invoiceNo}: "${name}" (raw: "${surgeonRaw}")`);
      }
    }

    const status = mapStatus(str(r["STATUS"]) ?? "");
    const billTo = str(r["INNOSYS BILL TO AFFIRMA"]);

    toInsert.push({
      id: nanoid(), organizationId: orgId, invoiceNo,
      invoiceDate: toDate(r["DATE"]) ?? new Date(),
      salesPersonName: str(r["Sales Person"]), applicationSpecialistName: str(r["Sales Person"]),
      customerId, customerSnapshot,
      customerPoNo: str(r["LPO"]), salesOrderNo: str(r["SALES ORDER NO"]),
      grandTotal: toMoney(r["TOTAL SO"]), subtotal: toMoney(r["TOTAL SO"]),
      status, paidAt: toDate(r["PAYMENT DATE"]) ?? null, paymentRef: str(r["PAYMENT REF"]),
      soaVerified: soaVerified(r["SOA Status"]),
      caseDate: toDate(r["DATE"]) ?? null, caseType: str(r["CASE"]), caseTime: str(r["TIME"]), mrnNo: str(r["MRN NO"]),
      notes: billTo ? `Innosys bill to Affirma: ${billTo}` : null,
      createdBy: CREATED_BY,
    });
  }

  console.log(`To insert: ${toInsert.length} new invoices (linked to customer: ${linkedCount})`);
  if (noCustomer.length) console.log(`Still unmatched (${noCustomer.length}): ${noCustomer.slice(0, 10).join("; ")}${noCustomer.length > 10 ? "..." : ""}`);
  if (toInsert.length > 0) {
    for (let i = 0; i < toInsert.length; i += 50) await db.insert(invoice).values(toInsert.slice(i, i + 50));
    console.log(`✓ Inserted ${toInsert.length} invoices`);
  }

  // ── Step 3: backfill customerId on existing unlinked invoices ────────────
  console.log("\n=== Step 3: backfill missing customer links ===");
  const invoiceNoToRow = new Map(grouped);
  let backfilled = 0;
  const allCurrentInvoices = await db
    .select({ id: invoice.id, invoiceNo: invoice.invoiceNo, organizationId: invoice.organizationId, customerId: invoice.customerId })
    .from(invoice)
    .where(inArray(invoice.organizationId, [...ALL_ORG_IDS]));
  for (const inv of allCurrentInvoices) {
    if (inv.customerId) continue;
    const row = invoiceNoToRow.get(`${inv.organizationId}|${inv.invoiceNo}`);
    const surgeonRaw = row ? str(row.first["SURGEON"]) : null;
    if (!surgeonRaw) continue;
    const { name } = normalizeSurgeon(surgeonRaw);
    const custId = customerIdByName.get(name);
    if (!custId) continue;
    const snap = snapshotFor(custId, row ? str(row.first["HOSPITAL"]) : null);
    await db.update(invoice).set({ customerId: custId, customerSnapshot: snap }).where(eq(invoice.id, inv.id));
    backfilled++;
  }
  console.log(`✓ Backfilled customer link on ${backfilled} previously-unlinked invoices`);

  // ── Step 3b: repair invoices whose snapshot is missing organizationName ──
  // Caused by a bug in an earlier version of this script's Step 1, which
  // wrote to a customerCompany.organizationName field that doesn't exist on
  // the real schema (it's a customerOrganizationId FK to customer_organization
  // instead) — silently dropping every hospital link it touched. Step 1
  // above is fixed now; this repairs the fallout for invoices already
  // created against the broken data.
  console.log("\n=== Step 3b: repair missing hospital in snapshot ===");
  const withCustomer = await db
    .select({ id: invoice.id, invoiceNo: invoice.invoiceNo, organizationId: invoice.organizationId, customerId: invoice.customerId, customerSnapshot: invoice.customerSnapshot })
    .from(invoice)
    .where(and(inArray(invoice.organizationId, [...ALL_ORG_IDS]), isNotNull(invoice.customerId)));
  const missingHospital = withCustomer.filter((inv) => !inv.customerSnapshot?.organizationName);
  let repaired = 0;
  for (const inv of missingHospital) {
    const row = invoiceNoToRow.get(`${inv.organizationId}|${inv.invoiceNo}`);
    const snap = snapshotFor(inv.customerId!, row ? str(row.first["HOSPITAL"]) : null);
    if (!snap?.organizationName) continue;
    await db.update(invoice).set({ customerSnapshot: snap }).where(eq(invoice.id, inv.id));
    repaired++;
  }
  console.log(`✓ Repaired hospital on ${repaired}/${missingHospital.length} invoice snapshots that were missing it`);

  // ── Step 4: rebuild case_commission for every invoice ─────────────────────
  console.log("\n=== Step 4: case commissions ===");
  const allInvoices = await db
    .select({ id: invoice.id, organizationId: invoice.organizationId, invoiceNo: invoice.invoiceNo, caseType: invoice.caseType })
    .from(invoice)
    .where(inArray(invoice.organizationId, [...ALL_ORG_IDS]));
  const invoiceIdMap = new Map(allInvoices.map((i) => [`${i.organizationId}|${i.invoiceNo}`, i.id]));
  const ourInvoiceIds = allInvoices.map((i) => i.id);

  for (let i = 0; i < ourInvoiceIds.length; i += 50) {
    await db.delete(caseCommission).where(inArray(caseCommission.invoiceId, ourInvoiceIds.slice(i, i + 50)));
  }
  type CommissionRow = typeof caseCommission.$inferInsert;
  const commissionRows: CommissionRow[] = [];
  for (const [key, { all: rows }] of grouped) {
    const [orgId] = key.split("|") as [string, string];
    const invoiceId = invoiceIdMap.get(key);
    if (!invoiceId) continue;
    const pick = (field: string) => rows.map((r) => str(r[field])).find((v) => v != null) ?? null;
    const pickMoney = (field: string) => rows.map((r) => toMoney(r[field])).find((v) => Number(v) > 0) ?? "0";
    const pickDate = (field: string) => rows.map((r) => toDate(r[field])).find((v) => v != null) ?? null;
    const claimedBy = pick("ATTEND COMMISSION CLAIM BY");
    const docs = pick("DOCS");
    const attendAmt = pickMoney("COMMISSION AMOUNT");
    const surgeonAmt = pickMoney("SURGEON COMMISSION");
    const surgeonPaid = pickDate("PAYMENT DATE_1");
    const incentive = pickMoney("Incentive");
    const actualAmt = pickMoney("Actual Amount");
    const hasData = claimedBy || docs || Number(attendAmt) > 0 || Number(surgeonAmt) > 0 || surgeonPaid || Number(incentive) > 0 || Number(actualAmt) > 0;
    if (!hasData) continue;
    commissionRows.push({ id: nanoid(), invoiceId, organizationId: orgId, claimedBy, docs, attendAmount: attendAmt, surgeonAmount: surgeonAmt, surgeonPaidAt: surgeonPaid ?? null, incentive, actualAmount: actualAmt });
  }
  if (commissionRows.length > 0) for (let i = 0; i < commissionRows.length; i += 50) await db.insert(caseCommission).values(commissionRows.slice(i, i + 50));
  console.log(`✓ Inserted ${commissionRows.length} commission rows`);

  // ── Step 5: assign document categories to every invoice ──────────────────
  console.log("\n=== Step 5: categories ===");
  const cats = await db
    .select({ id: documentCategory.id, organizationId: documentCategory.organizationId, name: documentCategory.name })
    .from(documentCategory)
    .where(inArray(documentCategory.organizationId, [...ALL_ORG_IDS]));
  const catIdByOrgAndName = new Map<string, string>();
  for (const c of cats) catIdByOrgAndName.set(`${c.organizationId}|${c.name.toLowerCase()}`, c.id);

  const missing = new Set<string>();
  for (const orgId of ALL_ORG_IDS) {
    for (const name of ["private", "laser"]) {
      if (!catIdByOrgAndName.has(`${orgId}|${name}`)) missing.add(`${orgId}: ${name}`);
    }
  }
  if (missing.size > 0) console.log(`WARNING — missing default categories, skipping those: ${[...missing].join(", ")}`);

  let categorized = 0;
  for (const inv of allInvoices) {
    const names = new Set(["private", "laser", ...caseTypeToCategoryNames(inv.caseType)]);
    const ids = [...names].map((n) => catIdByOrgAndName.get(`${inv.organizationId}|${n}`)).filter((id): id is string => !!id);
    if (ids.length === 0) continue;
    await db.update(invoice).set({ categoryIds: ids }).where(eq(invoice.id, inv.id));
    categorized++;
  }
  console.log(`✓ Set categoryIds on ${categorized} invoices`);

  // ── Step 6: rebuild delivery orders from the invoice table ───────────────
  console.log("\n=== Step 6: delivery orders ===");
  await sql`UPDATE invoice SET delivery_order_id = NULL, delivery_order_no = NULL WHERE organization_id = ANY(${[...ALL_ORG_IDS] as string[]}::text[])`;
  await sql`DELETE FROM delivery_order WHERE organization_id = ANY(${[...ALL_ORG_IDS] as string[]}::text[])`;
  await sql`DELETE FROM delivery_order_counter WHERE organization_id = ANY(${[...ALL_ORG_IDS] as string[]}::text[])`;

  const invoicesForDo = await db
    .select({
      id: invoice.id, organizationId: invoice.organizationId, invoiceNo: invoice.invoiceNo,
      invoiceDate: invoice.invoiceDate, status: invoice.status, customerId: invoice.customerId,
      customerSnapshot: invoice.customerSnapshot, customerPoNo: invoice.customerPoNo,
      salesOrderNo: invoice.salesOrderNo, caseType: invoice.caseType, notes: invoice.notes,
      createdBy: invoice.createdBy, categoryIds: invoice.categoryIds,
    })
    .from(invoice)
    .where(inArray(invoice.organizationId, [...ALL_ORG_IDS]));

  const maxByOrgYear = new Map<string, Map<number, number>>();
  let doInserted = 0;
  for (let i = 0; i < invoicesForDo.length; i += 50) {
    const batch = invoicesForDo.slice(i, i + 50);
    const doRows: (typeof deliveryOrder.$inferInsert)[] = [];
    const itemRows: (typeof deliveryOrderItem.$inferInsert)[] = [];
    const backfillLinks: { invoiceId: string; doId: string; doNo: string }[] = [];

    for (const inv of batch) {
      const doId = nanoid();
      const doNo = invoiceNoToDoNo(inv.invoiceNo);
      const invDate = inv.invoiceDate ? new Date(inv.invoiceDate) : new Date();
      const snap = inv.customerSnapshot;

      const year = invDate.getFullYear();
      const seqMatch = doNo.match(/(\d{4})$/);
      if (seqMatch) {
        const num = parseInt(seqMatch[1]);
        if (!maxByOrgYear.has(inv.organizationId)) maxByOrgYear.set(inv.organizationId, new Map());
        const m = maxByOrgYear.get(inv.organizationId)!;
        m.set(year, Math.max(m.get(year) ?? 0, num));
      }

      doRows.push({
        id: doId, organizationId: inv.organizationId, doNo,
        salesOrderNo: inv.salesOrderNo ?? null, customerPoNo: inv.customerPoNo ?? null,
        customerId: inv.customerId ?? null, customerSnapshot: snap ?? null,
        deliveredTo: snap?.name ?? null, deliveryAddress: snap?.organizationAddress ?? null,
        deliveryDate: invDate, notes: inv.notes ?? null,
        status: mapDoStatus(inv.status ?? "draft"), createdBy: inv.createdBy,
        categoryIds: inv.categoryIds ?? [],
      });
      if (inv.caseType) {
        itemRows.push({ id: nanoid(), deliveryOrderId: doId, rowNo: 1, description: inv.caseType, qty: "1", uom: null });
      }
      backfillLinks.push({ invoiceId: inv.id, doId, doNo });
    }

    await db.insert(deliveryOrder).values(doRows);
    if (itemRows.length > 0) await db.insert(deliveryOrderItem).values(itemRows);
    for (const { invoiceId, doId, doNo } of backfillLinks) {
      await sql`UPDATE invoice SET delivery_order_id = ${doId}, delivery_order_no = ${doNo} WHERE id = ${invoiceId}`;
    }
    doInserted += doRows.length;
    process.stdout.write(`\r  Progress: ${doInserted}/${invoicesForDo.length}`);
  }
  console.log(`\n✓ Inserted ${doInserted} delivery orders`);

  for (const [orgId, yearMap] of maxByOrgYear) {
    const latestYear = Math.max(...yearMap.keys());
    const latestNum = yearMap.get(latestYear)!;
    await sql`
      INSERT INTO delivery_order_counter (id, organization_id, year, last_number, updated_at)
      VALUES (${nanoid()}, ${orgId}, ${latestYear}, ${latestNum}, now())
      ON CONFLICT (organization_id) DO UPDATE SET year = EXCLUDED.year, last_number = EXCLUDED.last_number, updated_at = now()
    `;
  }

  console.log(`\n✓ Total invoices: ${invoicesForDo.length}`);
  console.log(`✓ Total DOs: ${doInserted}`);
  console.log(`✓ Commission rows: ${commissionRows.length}`);
  console.log(`✓ Categorized invoices: ${categorized}`);
  console.log("\nDone.");
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
