/**
 * Sync invoices + case commissions + delivery orders from the live
 * "Case Detail" Google Sheet — supersedes the old scripts/seed-invoices.ts
 * (which required a manual Excel export) by reading straight from the
 * Sheets API. Reuses the exact same normalization rules from seed-config.ts.
 *
 * Sheet: https://docs.google.com/spreadsheets/d/1q4-AlIajvMSloO_4dsnerTaKU-Yy1GrgeXqlLsq_AIA
 * Tab:   "Case Detail" (gid 862547153)
 *
 * Column drift vs. the original seed-invoices.ts (verified 2026-09-09):
 *   - "Sales Person" header is now blank — data is still there, at column
 *     index 7 by position. Positional fallback below.
 *   - "SOA Status" and "Incentive" columns no longer exist — gracefully
 *     default to false/"0", same as the original script already did for
 *     any missing column.
 *   - 3 rows have a blank COMPANY cell (all status=CANCELLED) — company is
 *     inferred from the invoice number prefix (INVAF→Affirma, INVSI→Innosys)
 *     as a fallback.
 *
 * Idempotent for invoices: skips any (orgId, invoiceNo) already in the DB.
 * case_commission: rebuilt for every invoice (old + new), since commission
 * fields (payment status, amounts) can change on rows already synced.
 * delivery_order: rebuilt from the invoice table for ALL_ORG_IDS, exactly
 * like the old seed-delivery-orders.ts — verified safe: every existing DO
 * for these two orgs already follows this same DOAF/DOSI derivation, there
 * is no unrelated real DO data in these orgs to lose.
 *
 * Run:
 *   npx dotenv-cli -e .env -- npx tsx scripts/sync-case-sheet.ts
 */

import { createSign } from "crypto";
import { nanoid } from "nanoid";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { inArray, eq } from "drizzle-orm";
import {
  invoice, caseCommission, customer, customerCompany, customerOrganization,
  deliveryOrder, deliveryOrderItem,
} from "../db/schema";
import {
  ORG, ALL_ORG_IDS, CREATED_BY, resolveOrgId,
  normalizeSurgeon, normalizeHospital, str, toMoney, toDate, mapStatus,
} from "./seed-config";

const SHEET_ID = "1q4-AlIajvMSloO_4dsnerTaKU-Yy1GrgeXqlLsq_AIA";
const TAB_NAME = "Case Detail";

// ─── Google Sheets read (service account JWT, matching lib/google-sheets.ts) ──

function cleanPrivateKey(raw: string): string {
  // Strip stray JSON-artifact quoting on top of normal PEM content, then
  // un-escape literal "\n" sequences into real newlines.
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
    // Positional fallback for the now-blank "Sales Person" header (col index 7).
    if (!obj["Sales Person"] && r[7]) obj["Sales Person"] = r[7];
    return obj;
  });
}

// Company cell is blank for a handful of CANCELLED rows — the invoice
// number prefix itself unambiguously encodes the org (INVAF→Affirma,
// INVSI→Innosys), same convention as delivery_order's DOAF/DOSI numbering.
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

async function main() {
  console.log("Fetching live sheet data...");
  const allRows = await fetchSheetRows();
  const invoiceRows = allRows.filter((r) => str(r["INVOICE NO"]));
  console.log(`Sheet rows with an INVOICE NO: ${invoiceRows.length}`);

  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle({ client: sql });

  // ── Step 1: sync invoices ─────────────────────────────────────────────────
  const allCustomers = await db
    .select({ id: customer.id, name: customer.name, title: customer.title, contactNo: customer.contactNo, email: customer.email })
    .from(customer)
    .where(inArray(customer.organizationId, [...ALL_ORG_IDS]));
  const allCompanies = await db
    .select({
      id: customerCompany.id, customerId: customerCompany.customerId,
      organizationName: customerOrganization.name, organizationAddress: customerOrganization.address,
      isPrimary: customerCompany.isPrimary,
    })
    .from(customerCompany)
    .leftJoin(customerOrganization, eq(customerOrganization.id, customerCompany.customerOrganizationId))
    .where(inArray(customerCompany.customerId, allCustomers.map((c) => c.id)));
  const customerByName = new Map(allCustomers.map((c) => [c.name.toLowerCase(), c]));
  const companiesByCustomer = new Map<string, typeof allCompanies>();
  for (const co of allCompanies) {
    if (!companiesByCustomer.has(co.customerId)) companiesByCustomer.set(co.customerId, []);
    companiesByCustomer.get(co.customerId)!.push(co);
  }
  console.log(`Loaded ${allCustomers.length} customers, ${allCompanies.length} companies`);

  const existing = await db
    .select({ invoiceNo: invoice.invoiceNo, organizationId: invoice.organizationId })
    .from(invoice)
    .where(inArray(invoice.organizationId, [...ALL_ORG_IDS]));
  const existingSet = new Set(existing.map((e) => `${e.organizationId}|${e.invoiceNo}`));
  console.log(`Existing invoices in DB: ${existingSet.size}`);

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
      const cust = customerByName.get(name.toLowerCase());
      if (cust) {
        customerId = cust.id;
        linkedCount++;
        const hospitalRaw = str(r["HOSPITAL"]);
        const hospital = hospitalRaw ? normalizeHospital(hospitalRaw) : null;
        const companies = companiesByCustomer.get(cust.id) ?? [];
        const company = hospital
          ? (companies.find((co) => co.organizationName?.toLowerCase() === hospital.toLowerCase()) ?? companies.find((co) => co.isPrimary) ?? companies[0])
          : (companies.find((co) => co.isPrimary) ?? companies[0]);
        customerSnapshot = {
          title: cust.title ?? undefined,
          name: cust.name,
          email: cust.email ?? undefined,
          contactNo: cust.contactNo ?? undefined,
          organizationName: company?.organizationName ?? undefined,
          organizationAddress: company?.organizationAddress ?? undefined,
        };
      } else {
        noCustomer.push(`${invoiceNo}: "${name}" (raw: "${surgeonRaw}")`);
      }
    }

    const statusRaw = str(r["STATUS"]) ?? "";
    const status = mapStatus(statusRaw);
    const paidAt = toDate(r["PAYMENT DATE"]) ?? null;
    const billTo = str(r["INNOSYS BILL TO AFFIRMA"]);
    const notes = billTo ? `Innosys bill to Affirma: ${billTo}` : null;

    toInsert.push({
      id: nanoid(),
      organizationId: orgId,
      invoiceNo,
      invoiceDate: toDate(r["DATE"]) ?? new Date(),
      salesPersonName: str(r["Sales Person"]),
      applicationSpecialistName: str(r["Sales Person"]),
      customerId,
      customerSnapshot,
      customerPoNo: str(r["LPO"]),
      salesOrderNo: str(r["SALES ORDER NO"]),
      grandTotal: toMoney(r["TOTAL SO"]),
      subtotal: toMoney(r["TOTAL SO"]),
      status,
      paidAt,
      paymentRef: str(r["PAYMENT REF"]),
      soaVerified: soaVerified(r["SOA Status"]),
      caseDate: toDate(r["DATE"]) ?? null,
      caseType: str(r["CASE"]),
      caseTime: str(r["TIME"]),
      mrnNo: str(r["MRN NO"]),
      notes,
      createdBy: CREATED_BY,
    });
  }

  console.log(`\nTo insert: ${toInsert.length} new invoices`);
  console.log(`Linked to customer: ${linkedCount}`);
  if (noCustomer.length) {
    console.log(`Surgeon not found (${noCustomer.length}):`);
    noCustomer.forEach((s) => console.log(`  !! ${s}`));
  }

  const BATCH = 50;
  if (toInsert.length > 0) {
    for (let i = 0; i < toInsert.length; i += BATCH) {
      await db.insert(invoice).values(toInsert.slice(i, i + BATCH));
    }
    console.log(`✓ Inserted ${toInsert.length} invoices`);
  }

  // ── Step 2: rebuild case_commission for every invoice ────────────────────
  const allInvoices = await db
    .select({ id: invoice.id, organizationId: invoice.organizationId, invoiceNo: invoice.invoiceNo })
    .from(invoice)
    .where(inArray(invoice.organizationId, [...ALL_ORG_IDS]));
  const invoiceIdMap = new Map(allInvoices.map((i) => [`${i.organizationId}|${i.invoiceNo}`, i.id]));
  const ourInvoiceIds = allInvoices.map((i) => i.id);

  console.log(`\nRebuilding commissions for ${ourInvoiceIds.length} invoices...`);
  for (let i = 0; i < ourInvoiceIds.length; i += BATCH) {
    await db.delete(caseCommission).where(inArray(caseCommission.invoiceId, ourInvoiceIds.slice(i, i + BATCH)));
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

    commissionRows.push({
      id: nanoid(), invoiceId, organizationId: orgId,
      claimedBy, docs, attendAmount: attendAmt, surgeonAmount: surgeonAmt,
      surgeonPaidAt: surgeonPaid ?? null, incentive, actualAmount: actualAmt,
    });
  }
  if (commissionRows.length > 0) {
    for (let i = 0; i < commissionRows.length; i += BATCH) {
      await db.insert(caseCommission).values(commissionRows.slice(i, i + BATCH));
    }
  }
  console.log(`✓ Inserted ${commissionRows.length} commission rows`);

  // ── Step 3: rebuild delivery orders from the invoice table ───────────────
  console.log("\nRebuilding delivery orders...");
  await sql`UPDATE invoice SET delivery_order_id = NULL, delivery_order_no = NULL WHERE organization_id = ANY(${[...ALL_ORG_IDS] as string[]}::text[])`;
  await sql`DELETE FROM delivery_order WHERE organization_id = ANY(${[...ALL_ORG_IDS] as string[]}::text[])`;
  await sql`DELETE FROM delivery_order_counter WHERE organization_id = ANY(${[...ALL_ORG_IDS] as string[]}::text[])`;

  const invoicesForDo = await db
    .select({
      id: invoice.id, organizationId: invoice.organizationId, invoiceNo: invoice.invoiceNo,
      invoiceDate: invoice.invoiceDate, status: invoice.status, customerId: invoice.customerId,
      customerSnapshot: invoice.customerSnapshot, customerPoNo: invoice.customerPoNo,
      salesOrderNo: invoice.salesOrderNo, caseType: invoice.caseType, notes: invoice.notes, createdBy: invoice.createdBy,
    })
    .from(invoice)
    .where(inArray(invoice.organizationId, [...ALL_ORG_IDS]));

  const maxByOrgYear = new Map<string, Map<number, number>>();
  let doInserted = 0;
  for (let i = 0; i < invoicesForDo.length; i += BATCH) {
    const batch = invoicesForDo.slice(i, i + BATCH);
    const doRows: (typeof deliveryOrder.$inferInsert)[] = [];
    const itemRows: (typeof deliveryOrderItem.$inferInsert)[] = [];
    const backfill: { invoiceId: string; doId: string; doNo: string }[] = [];

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
      });
      if (inv.caseType) {
        itemRows.push({ id: nanoid(), deliveryOrderId: doId, rowNo: 1, description: inv.caseType, qty: "1", uom: null });
      }
      backfill.push({ invoiceId: inv.id, doId, doNo });
    }

    await db.insert(deliveryOrder).values(doRows);
    if (itemRows.length > 0) await db.insert(deliveryOrderItem).values(itemRows);
    for (const { invoiceId, doId, doNo } of backfill) {
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

  console.log(`\n✓ Total invoices in DB: ${invoicesForDo.length}`);
  console.log(`✓ Total DOs in DB: ${doInserted}`);
  console.log(`✓ Commission rows: ${commissionRows.length}`);
  console.log("\nDone.");
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
