/**
 * Non-destructive update of invoices + delivery orders from the live
 * "Case Detail" Google Sheet. Unlike scripts/sync-case-sheet.ts this NEVER
 * deletes anything (no DO rebuild, no commission/category/affiliation wipe):
 *
 *   1. Insert invoices that are in the sheet but not in the DB (with their
 *      case commission row and document categories — new invoices only).
 *   2. Update EXISTING invoices from the sheet (the sheet wins): status,
 *      payment date and payment ref. Guards:
 *        - an app-set "overdue" is not downgraded to "sent"
 *        - a blank sheet payment ref never wipes a ref already in the DB
 *   3. Create a delivery order for every invoice that has none (new ones),
 *      linking an already-existing DO with the same number instead of
 *      duplicating it.
 *   4. Sync DO status from the invoice status — imported DOs only
 *      (is_case_do = false, never a DO the app cancelled).
 *
 * Dry run by default (prints the plan, writes nothing). Add --apply to write.
 *
 *   npx dotenv-cli -e .env -- npx tsx scripts/update-invoices-dos-from-sheet.ts
 *   npx dotenv-cli -e .env -- npx tsx scripts/update-invoices-dos-from-sheet.ts --apply
 */

import { createSign } from "crypto";
import { nanoid } from "nanoid";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { inArray, eq, and } from "drizzle-orm";
import {
  invoice, caseCommission, customer, customerCompany, customerOrganization,
  deliveryOrder, deliveryOrderItem, documentCategory,
} from "../db/schema";
import {
  ORG, ALL_ORG_IDS, CREATED_BY, resolveOrgId,
  normalizeSurgeon, normalizeHospital, str, toMoney, toDate, mapStatus,
} from "./seed-config";

const APPLY = process.argv.includes("--apply");
const SHEET_ID = "1q4-AlIajvMSloO_4dsnerTaKU-Yy1GrgeXqlLsq_AIA";
const TAB_NAME = "Case Detail";

// ─── Google Sheets read (service account JWT) ────────────────────────────────

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
  const jwt = `${header}.${payload}.${sign.sign(privateKey, "base64url")}`;
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
  const token = await getAccessToken(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!, cleanPrivateKey(process.env.GOOGLE_PRIVATE_KEY!));
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/'${TAB_NAME}'!A1:BA2000`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`Sheets API error: ${JSON.stringify(data)}`);
  const rows: string[][] = data.values ?? [];

  // The sheet has two "PAYMENT DATE" columns (invoice payment, then the surgeon
  // commission payment). Keep the first under its own name and suffix repeats
  // (_1, _2…) so the later column cannot overwrite the invoice payment date.
  const seen = new Map<string, number>();
  const headers = (rows[0] ?? []).map((h) => {
    if (!h) return "";
    const n = seen.get(h) ?? 0;
    seen.set(h, n + 1);
    return n === 0 ? h : `${h}_${n}`;
  });

  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { if (h) obj[h] = r[i] ?? ""; });
    if (!obj["Sales Person"] && r[7]) obj["Sales Person"] = r[7];
    return obj;
  });
}

// ─── Helpers (same rules as sync-case-sheet.ts) ──────────────────────────────

function orgIdFor(company: unknown, invoiceNo: string): string | null {
  const direct = resolveOrgId(company);
  if (direct) return direct;
  if (/^INVAF\//i.test(invoiceNo)) return ORG.affirma;
  if (/^INVSI\//i.test(invoiceNo)) return ORG.innosys;
  return null;
}

const invoiceNoToDoNo = (no: string) => no.replace(/^INV/, "DO");

function mapDoStatus(invoiceStatus: string): string {
  switch (invoiceStatus) {
    case "paid":
    case "sent":
    case "overdue": return "delivered";
    case "cancelled": return "returned";
    default: return "draft";
  }
}

function caseTypeToCategoryNames(caseType: string | null | undefined): string[] {
  if (!caseType) return [];
  const names: string[] = [];
  for (const part of caseType.toUpperCase().split(/[&,/]+/).map((p) => p.trim()).filter(Boolean)) {
    if (part === "EVLT") names.push("evlt");
    else if (part === "MILH") names.push("milh");
    else if (part === "PLDD") names.push("pldd");
    else if (part === "RFA") names.push("rfa");
    else if (part === "FISTULA" || part === "FILAC") names.push("filac");
    else if (part === "SILAC") names.push("silac");
  }
  return [...new Set(names)];
}

const sameDay = (a: Date | null | undefined, b: Date | null | undefined) =>
  (!a && !b) || (!!a && !!b && a.toDateString() === b.toDateString());

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (writes)" : "DRY RUN (no writes)"}`);
  console.log(`DB host: ${new URL(process.env.DATABASE_URL!).host}`);
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle({ client: sql });

  const allRows = await fetchSheetRows();
  const invoiceRows = allRows.filter((r) => str(r["INVOICE NO"]));
  console.log(`Sheet rows with an INVOICE NO: ${invoiceRows.length}`);

  // group sheet rows per (org, invoiceNo) — several sheet rows can share one invoice
  const grouped = new Map<string, { first: Record<string, string>; all: Record<string, string>[] }>();
  for (const r of invoiceRows) {
    const no = str(r["INVOICE NO"])!;
    const orgId = orgIdFor(r["COMPANY"], no);
    if (!orgId) continue;
    const key = `${orgId}|${no}`;
    if (!grouped.has(key)) grouped.set(key, { first: r, all: [] });
    grouped.get(key)!.all.push(r);
  }

  // ── existing DB state ───────────────────────────────────────────────────────
  const existing = await db
    .select({
      id: invoice.id, invoiceNo: invoice.invoiceNo, organizationId: invoice.organizationId,
      status: invoice.status, paidAt: invoice.paidAt, paymentRef: invoice.paymentRef,
      deliveryOrderId: invoice.deliveryOrderId, customerId: invoice.customerId,
    })
    .from(invoice)
    .where(inArray(invoice.organizationId, [...ALL_ORG_IDS]));
  const existingByKey = new Map(existing.map((e) => [`${e.organizationId}|${e.invoiceNo}`, e]));

  // ── customers (match only — never create or rewrite here) ───────────────────
  const customers = await db
    .select({ id: customer.id, name: customer.name, title: customer.title, contactNo: customer.contactNo, email: customer.email })
    .from(customer)
    .where(inArray(customer.organizationId, [...ALL_ORG_IDS]));
  const customerByName = new Map(customers.map((c) => [c.name, c]));
  const companies = await db
    .select({
      customerId: customerCompany.customerId, isPrimary: customerCompany.isPrimary,
      organizationName: customerOrganization.name, organizationAddress: customerOrganization.address,
    })
    .from(customerCompany)
    .leftJoin(customerOrganization, eq(customerOrganization.id, customerCompany.customerOrganizationId))
    .where(inArray(customerCompany.customerId, customers.map((c) => c.id)));
  const companiesByCustomer = new Map<string, typeof companies>();
  for (const co of companies) {
    if (!companiesByCustomer.has(co.customerId)) companiesByCustomer.set(co.customerId, []);
    companiesByCustomer.get(co.customerId)!.push(co);
  }
  function snapshotFor(customerId: string, hospitalHint?: string | null) {
    const cust = customers.find((c) => c.id === customerId);
    if (!cust) return null;
    const cos = companiesByCustomer.get(customerId) ?? [];
    const hospital = hospitalHint ? normalizeHospital(hospitalHint) : null;
    const co = hospital
      ? (cos.find((x) => x.organizationName?.toLowerCase() === hospital.toLowerCase()) ?? cos.find((x) => x.isPrimary) ?? cos[0])
      : (cos.find((x) => x.isPrimary) ?? cos[0]);
    return {
      title: cust.title ?? undefined, name: cust.name, email: cust.email ?? undefined, contactNo: cust.contactNo ?? undefined,
      organizationName: co?.organizationName ?? undefined, organizationAddress: co?.organizationAddress ?? undefined,
    };
  }

  const cats = await db
    .select({ id: documentCategory.id, organizationId: documentCategory.organizationId, name: documentCategory.name })
    .from(documentCategory)
    .where(inArray(documentCategory.organizationId, [...ALL_ORG_IDS]));
  const catId = new Map(cats.map((c) => [`${c.organizationId}|${c.name.toLowerCase()}`, c.id]));

  // ── 1. new invoices ─────────────────────────────────────────────────────────
  type InvoiceInsert = typeof invoice.$inferInsert;
  const toInsert: InvoiceInsert[] = [];
  const commissions: (typeof caseCommission.$inferInsert)[] = [];
  const unmatchedSurgeon: string[] = [];

  for (const [key, { first: r, all: rows }] of grouped) {
    if (existingByKey.has(key)) continue;
    const [orgId, invoiceNo] = key.split("|") as [string, string];

    let customerId: string | null = null;
    let customerSnapshot: InvoiceInsert["customerSnapshot"] = null;
    const surgeonRaw = str(r["SURGEON"]);
    if (surgeonRaw) {
      const { name } = normalizeSurgeon(surgeonRaw);
      const c = customerByName.get(name);
      if (c) { customerId = c.id; customerSnapshot = snapshotFor(c.id, str(r["HOSPITAL"])); }
      else unmatchedSurgeon.push(`${invoiceNo}: "${name}"`);
    }

    const status = mapStatus(str(r["STATUS"]) ?? "");
    const billTo = str(r["INNOSYS BILL TO AFFIRMA"]);
    const caseType = str(r["CASE"]);
    const catNames = new Set(["private", "laser", ...caseTypeToCategoryNames(caseType)]);
    const categoryIds = [...catNames].map((n) => catId.get(`${orgId}|${n}`)).filter((x): x is string => !!x);
    const id = nanoid();

    toInsert.push({
      id, organizationId: orgId, invoiceNo,
      // existing records use the case date as the invoice date — stay consistent
      invoiceDate: toDate(r["DATE"]) ?? new Date(),
      salesPersonName: str(r["Sales Person"]), applicationSpecialistName: str(r["Sales Person"]),
      customerId, customerSnapshot,
      customerPoNo: str(r["LPO"]), salesOrderNo: str(r["SALES ORDER NO"]),
      grandTotal: toMoney(r["TOTAL SO"]), subtotal: toMoney(r["TOTAL SO"]),
      status, paidAt: status === "paid" ? (toDate(r["PAYMENT DATE"]) ?? null) : null,
      paymentRef: str(r["PAYMENT REF"]),
      caseDate: toDate(r["DATE"]) ?? null, caseType, caseTime: str(r["TIME"]), mrnNo: str(r["MRN NO"]),
      notes: billTo ? `Innosys bill to Affirma: ${billTo}` : null,
      categoryIds, createdBy: CREATED_BY,
    });

    const pick = (f: string) => rows.map((x) => str(x[f])).find((v) => v != null) ?? null;
    const pickMoney = (f: string) => rows.map((x) => toMoney(x[f])).find((v) => Number(v) > 0) ?? "0";
    const claimedBy = pick("ATTEND COMMISSION CLAIM BY");
    const docs = pick("DOCS");
    const attendAmt = pickMoney("COMMISSION AMOUNT");
    const surgeonAmt = pickMoney("SURGEON COMMISSION");
    const surgeonPaid = rows.map((x) => toDate(x["PAYMENT DATE_1"])).find((v) => v != null) ?? null;
    const actualAmt = pickMoney("Actual Amount");
    if (claimedBy || docs || Number(attendAmt) > 0 || Number(surgeonAmt) > 0 || surgeonPaid || Number(actualAmt) > 0) {
      commissions.push({
        id: nanoid(), invoiceId: id, organizationId: orgId, claimedBy, docs,
        attendAmount: attendAmt, surgeonAmount: surgeonAmt, surgeonPaidAt: surgeonPaid,
        incentive: "0", actualAmount: actualAmt,
      });
    }
  }

  // ── 2. updates to existing invoices ─────────────────────────────────────────
  type Upd = { id: string; invoiceNo: string; set: Partial<InvoiceInsert>; why: string[] };
  const updates: Upd[] = [];
  for (const [key, { first: r }] of grouped) {
    const cur = existingByKey.get(key);
    if (!cur) continue;
    const sheetStatus = mapStatus(str(r["STATUS"]) ?? "");
    const set: Partial<InvoiceInsert> = {};
    const why: string[] = [];

    const keepOverdue = cur.status === "overdue" && sheetStatus === "sent";
    if (!keepOverdue && cur.status !== sheetStatus) { set.status = sheetStatus; why.push(`status ${cur.status}→${sheetStatus}`); }

    const effStatus = (set.status ?? cur.status) as string;
    const sheetPaid = toDate(r["PAYMENT DATE"]) ?? null;
    if (effStatus === "paid") {
      if (sheetPaid && !sameDay(cur.paidAt, sheetPaid)) { set.paidAt = sheetPaid; why.push("paid date"); }
    } else if (cur.paidAt && (sheetStatus === "sent" || sheetStatus === "cancelled")) {
      set.paidAt = null; why.push("clear paid date");
    }
    const sheetRef = str(r["PAYMENT REF"]);
    if (sheetRef && sheetRef !== cur.paymentRef) { set.paymentRef = sheetRef; why.push("payment ref"); }

    if (why.length) updates.push({ id: cur.id, invoiceNo: cur.invoiceNo ?? key, set, why });
  }

  // ── 3 + 4. delivery orders ──────────────────────────────────────────────────
  const existingDos = await db
    .select({ id: deliveryOrder.id, organizationId: deliveryOrder.organizationId, doNo: deliveryOrder.doNo, status: deliveryOrder.status, isCaseDo: deliveryOrder.isCaseDo })
    .from(deliveryOrder)
    .where(inArray(deliveryOrder.organizationId, [...ALL_ORG_IDS]));
  const doByKey = new Map(existingDos.map((d) => [`${d.organizationId}|${d.doNo}`, d]));

  const doInserts: (typeof deliveryOrder.$inferInsert)[] = [];
  const doItems: (typeof deliveryOrderItem.$inferInsert)[] = [];
  const doLinks: { invoiceId: string; doId: string; doNo: string }[] = [];
  const doStatusUpdates: { id: string; doNo: string; from: string; to: string }[] = [];
  const maxSeq = new Map<string, { year: number; num: number }>();

  // invoices needing a DO: the new ones + any existing invoice with no DO link
  const needsDo: { invoiceId: string; orgId: string; row: InvoiceInsert }[] = [];
  for (const row of toInsert) needsDo.push({ invoiceId: row.id!, orgId: row.organizationId, row });
  const existingRows = existing.filter((e) => !e.deliveryOrderId);
  if (existingRows.length) {
    const full = await db.select().from(invoice).where(inArray(invoice.id, existingRows.map((e) => e.id)));
    for (const f of full) needsDo.push({ invoiceId: f.id, orgId: f.organizationId, row: f as unknown as InvoiceInsert });
  }
  for (const { invoiceId, orgId, row } of needsDo) {
    const doNo = invoiceNoToDoNo(row.invoiceNo);
    const found = doByKey.get(`${orgId}|${doNo}`);
    if (found) { doLinks.push({ invoiceId, doId: found.id, doNo }); continue; }
    const doId = nanoid();
    const invDate = row.invoiceDate ? new Date(row.invoiceDate) : new Date();
    const snap = (row.customerSnapshot ?? null) as any;
    doInserts.push({
      id: doId, organizationId: orgId, doNo,
      salesOrderNo: row.salesOrderNo ?? null, customerPoNo: row.customerPoNo ?? null,
      customerId: row.customerId ?? null, customerSnapshot: snap,
      deliveredTo: snap?.name ?? null, deliveryAddress: snap?.organizationAddress ?? null,
      deliveryDate: invDate, notes: row.notes ?? null,
      status: mapDoStatus((row.status as string) ?? "draft"), createdBy: row.createdBy,
      categoryIds: (row.categoryIds as string[]) ?? [],
    });
    if (row.caseType) doItems.push({ id: nanoid(), deliveryOrderId: doId, rowNo: 1, description: row.caseType, qty: "1", uom: null });
    doLinks.push({ invoiceId, doId, doNo });
    const m = doNo.match(/(\d{4})$/);
    if (m) {
      const cur = maxSeq.get(orgId);
      const year = invDate.getFullYear();
      const num = parseInt(m[1]);
      if (!cur || year > cur.year || (year === cur.year && num > cur.num)) maxSeq.set(orgId, { year, num });
    }
  }

  // DO status sync — every invoice that has a DO, using the invoice status after this run
  const finalStatus = new Map<string, string>(); // `${org}|${invoiceNo}` -> status
  for (const e of existing) finalStatus.set(`${e.organizationId}|${e.invoiceNo}`, e.status as string);
  for (const u of updates) {
    const e = existing.find((x) => x.id === u.id)!;
    if (u.set.status) finalStatus.set(`${e.organizationId}|${e.invoiceNo}`, u.set.status as string);
  }
  for (const [key, st] of finalStatus) {
    const [orgId, invoiceNo] = key.split("|") as [string, string];
    const d = doByKey.get(`${orgId}|${invoiceNoToDoNo(invoiceNo)}`);
    if (!d || d.isCaseDo || d.status === "cancelled") continue;
    const want = mapDoStatus(st);
    if (d.status !== want) doStatusUpdates.push({ id: d.id, doNo: d.doNo, from: d.status, to: want });
  }

  // ── report ──────────────────────────────────────────────────────────────────
  const tally = (xs: string[]) => xs.reduce<Record<string, number>>((a, k) => ((a[k] = (a[k] ?? 0) + 1), a), {});
  console.log("\n=== PLAN ===");
  console.log(`New invoices:            ${toInsert.length}  (${toInsert.slice(0, 4).map((i) => i.invoiceNo).join(", ")}${toInsert.length > 4 ? ", …" : ""})`);
  console.log(`  with a commission row: ${commissions.length}`);
  console.log(`  surgeon not matched:   ${unmatchedSurgeon.length}${unmatchedSurgeon.length ? "  " + unmatchedSurgeon.slice(0, 8).join("; ") : ""}`);
  console.log(`Existing invoices to update: ${updates.length}`);
  console.log(`  changes: ${JSON.stringify(tally(updates.flatMap((u) => u.why.map((w) => w.replace(/→.*/, "→…")))))}`);
  for (const u of updates.slice(0, 12)) console.log(`   - ${u.invoiceNo}: ${u.why.join(", ")}`);
  console.log(`New delivery orders:     ${doInserts.length}`);
  console.log(`DO links to (re)attach:  ${doLinks.length - doInserts.length} existing DO(s) matched by number`);
  console.log(`DO status updates:       ${doStatusUpdates.length}  ${JSON.stringify(tally(doStatusUpdates.map((d) => `${d.from}→${d.to}`)))}`);

  if (!APPLY) { console.log("\nDry run — nothing written. Re-run with --apply to write."); return; }

  // ── apply ───────────────────────────────────────────────────────────────────
  console.log("\n=== APPLY ===");
  for (let i = 0; i < toInsert.length; i += 50) await db.insert(invoice).values(toInsert.slice(i, i + 50));
  for (let i = 0; i < commissions.length; i += 50) await db.insert(caseCommission).values(commissions.slice(i, i + 50));
  console.log(`✓ inserted ${toInsert.length} invoices, ${commissions.length} commission rows`);

  for (const u of updates) await db.update(invoice).set(u.set).where(eq(invoice.id, u.id));
  console.log(`✓ updated ${updates.length} invoices`);

  for (let i = 0; i < doInserts.length; i += 50) await db.insert(deliveryOrder).values(doInserts.slice(i, i + 50));
  for (let i = 0; i < doItems.length; i += 50) await db.insert(deliveryOrderItem).values(doItems.slice(i, i + 50));
  for (const { invoiceId, doId, doNo } of doLinks) {
    await db.update(invoice).set({ deliveryOrderId: doId, deliveryOrderNo: doNo }).where(and(eq(invoice.id, invoiceId)));
  }
  console.log(`✓ created ${doInserts.length} delivery orders, linked ${doLinks.length}`);

  for (const d of doStatusUpdates) await db.update(deliveryOrder).set({ status: d.to }).where(eq(deliveryOrder.id, d.id));
  console.log(`✓ synced status on ${doStatusUpdates.length} delivery orders`);

  for (const [orgId, { year, num }] of maxSeq) {
    await sql`
      INSERT INTO delivery_order_counter (id, organization_id, year, last_number, updated_at)
      VALUES (${nanoid()}, ${orgId}, ${year}, ${num}, now())
      ON CONFLICT (organization_id) DO UPDATE SET
        last_number = CASE
          WHEN delivery_order_counter.year = EXCLUDED.year THEN GREATEST(delivery_order_counter.last_number, EXCLUDED.last_number)
          WHEN EXCLUDED.year > delivery_order_counter.year THEN EXCLUDED.last_number
          ELSE delivery_order_counter.last_number END,
        year = GREATEST(delivery_order_counter.year, EXCLUDED.year),
        updated_at = now()
    `;
  }
  console.log("Done.");
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
