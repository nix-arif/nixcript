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
 *
 * --sheet-wins: also bring every other imported field of existing invoices in line with the sheet (amount, MRN, case
 * type/time/date, LPO, SO no, surgeon/hospital). Blank cells, a 0 total, and shifted-column values are never written;
 * a cancelled invoice zeroed in the sheet is left as it is; the sales person (a staff account in the system) is kept.
 * After an apply, the invoice list's summary figures are refreshed.
 *
 * Without the Google service account (e.g. .env.local), read a CSV export of the tab instead:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/update-invoices-dos-from-sheet.ts --csv case-detail.csv
 */

import { createSign } from "crypto";
import { nanoid } from "nanoid";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { inArray, eq, and, isNull } from "drizzle-orm";
import {
  invoice, caseCommission, customer, customerCompany, customerOrganization, user, member,
  deliveryOrder, deliveryOrderItem, documentCategory, invoiceStats,
} from "../db/schema";
import { computeInvoiceStats } from "../lib/invoice/stats";
import {
  ORG, ALL_ORG_IDS, CREATED_BY, resolveOrgId,
  normalizeSurgeon, normalizeHospital, str, toMoney, toDate, mapStatus,
} from "./seed-config";

const APPLY = process.argv.includes("--apply");
const SHEET_WINS = process.argv.includes("--sheet-wins"); // update every imported field of existing invoices, not only status/payment
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

// --csv <file>: read the tab from a CSV export instead of the Sheets API (File → Download → CSV, or the sheet's
// /export?format=csv&gid=862547153 link). It holds the same displayed values the API returns, for when the Google
// service account is not set up (e.g. in .env.local).
const CSV_ARG = process.argv.indexOf("--csv");
const CSV_FILE = CSV_ARG >= 0 ? process.argv[CSV_ARG + 1] : null;

// RFC 4180: quoted fields, "" inside quotes, line breaks inside quotes
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); out.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); out.push(row); }
  return out;
}

async function readRows(): Promise<string[][]> {
  if (CSV_FILE) {
    const { readFileSync } = await import("fs");
    return parseCsv(readFileSync(CSV_FILE, "utf8"));
  }
  const token = await getAccessToken(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!, cleanPrivateKey(process.env.GOOGLE_PRIVATE_KEY!));
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/'${TAB_NAME}'!A1:BA2000`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`Sheets API error: ${JSON.stringify(data)}`);
  return data.values ?? [];
}

async function fetchSheetRows(): Promise<Record<string, string>[]> {
  const rows = await readRows();

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
      // compared only with --sheet-wins
      grandTotal: invoice.grandTotal, subtotal: invoice.subtotal, paidAmount: invoice.paidAmount,
      costTotal: invoice.costTotal, expensesTotal: invoice.expensesTotal, profit: invoice.profit,
      mrnNo: invoice.mrnNo, caseType: invoice.caseType, caseTime: invoice.caseTime, caseDate: invoice.caseDate,
      invoiceDate: invoice.invoiceDate, customerPoNo: invoice.customerPoNo, salesOrderNo: invoice.salesOrderNo,
      salesPersonName: invoice.salesPersonName, applicationSpecialistName: invoice.applicationSpecialistName,
      customerSnapshot: invoice.customerSnapshot, categoryIds: invoice.categoryIds,
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

  // The staff the sheet's "Sales Person" names: the users of both companies. The sheet often writes a short form of
  // the username ("syahidah" for syahidahsubari, "Zila" for Zilarahim); the system uses the username, linked to the
  // account. An exact username (any case) wins; else the one username starting with it (4+ letters, only if exactly
  // one does). Anything else (a team label such as "Iwan & Zila") is kept as written, with no account.
  const staff = await db
    .selectDistinct({ id: user.id, name: user.name })
    .from(member).innerJoin(user, eq(user.id, member.userId))
    .where(inArray(member.organizationId, [...ALL_ORG_IDS]));
  function staffFor(raw: string | null): { id: string | null; name: string | null } {
    if (!raw) return { id: null, name: null };
    const v = raw.trim().toLowerCase();
    const exact = staff.find((s) => s.name.toLowerCase() === v);
    if (exact) return exact;
    const starts = v.length >= 4 && /^[a-z]+$/.test(v) ? staff.filter((s) => s.name.toLowerCase().startsWith(v)) : [];
    return starts.length === 1 ? starts[0] : { id: null, name: raw.trim() };
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
      // the staff account the sheet's name stands for ("syahidah" → syahidahsubari), linked; a team label stays text
      ...(() => {
        const sp = staffFor(str(r["Sales Person"]));
        return { salesPersonId: sp.id, salesPersonName: sp.name, applicationSpecialistId: sp.id, applicationSpecialistName: sp.name };
      })(),
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

  // --sheet-wins: every field the import takes from the sheet is brought in line with it, not only status and payment.
  // A sheet value is used only when it is a real value for that field:
  //  - a blank cell never wipes what the system has
  //  - a total of 0 (or not a number) never replaces a real total (a cancelled invoice zeroed in the sheet keeps its value)
  //  - an SO / PO number that is just an amount (a row shifted by a column) is skipped
  // When the total changes, a paid amount already recorded follows it, and so does the profit if it was in line.
  type Cur = (typeof existing)[number];
  const caseTypeChanges: { invoiceId: string; doId: string | null; orgId: string; from: string | null; to: string }[] = [];
  // invoices given their customer now (it was missing): their DO gets the same customer
  const customerLinks: { doId: string | null; customerId: string; snapshot: InvoiceInsert["customerSnapshot"] }[] = [];
  // a few before → after examples of each kind of change, printed with the plan
  const examples = new Map<string, string[]>();
  const example = (label: string, line: string) => { const l = examples.get(label) ?? []; if (l.length < 4) l.push(line); examples.set(label, l); };
  const looksLikeMoney = (s: string) => /^[\d,]+(\.\d+)?$/.test(s);
  const klDay = (d: Date | string | null | undefined) => (d ? new Date(new Date(d).getTime() + 8 * 3600_000).toISOString().slice(0, 10) : null);
  // toDate (seed-config) builds the date at local midnight: its calendar day is in local time, not UTC
  const sheetDay = (d: Date | undefined) =>
    d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null;
  // the case-type categories (evlt, milh, …) of every org, to swap them when the case type changes
  const CASE_CATS = ["evlt", "milh", "pldd", "rfa", "filac", "silac"];
  const caseCatIds = new Set(cats.filter((c) => CASE_CATS.includes(c.name.toLowerCase())).map((c) => c.id));
  const withCaseCats = (orgId: string, ids: string[], caseType: string) => [
    ...ids.filter((id) => !caseCatIds.has(id)),
    ...caseTypeToCategoryNames(caseType).map((n) => catId.get(`${orgId}|${n}`)).filter((x): x is string => !!x),
  ];
  let salesPersonDiffers = 0; // counted, never changed: the system has the staff account, the sheet a team label

  function sheetWins(cur: Cur, r: Record<string, string>, set: Partial<InvoiceInsert>, why: string[]) {
    // a cancelled invoice zeroed in the sheet ("Reuse running at …"): its row is a placeholder, the system's record stays
    if (mapStatus(str(r["STATUS"]) ?? "") === "cancelled" && !(Number(toMoney(r["TOTAL SO"])) > 0)) return;
    const total = Number(toMoney(r["TOTAL SO"]));
    if (Number.isFinite(total) && total > 0 && Math.abs(total - Number(cur.grandTotal ?? 0)) >= 0.005) {
      const t = total.toFixed(2);
      set.grandTotal = t; set.subtotal = t;
      why.push(`amount ${cur.grandTotal}→${t}`);
      const paid = Number(cur.paidAmount ?? 0);
      if (paid > 0) { set.paidAmount = t; why.push("paid amount follows"); }
      const cost = Number(cur.costTotal ?? 0), exp = Number(cur.expensesTotal ?? 0);
      if (Math.abs(Number(cur.profit ?? 0) - (Number(cur.grandTotal ?? 0) - cost - exp)) < 0.005) set.profit = (total - cost - exp).toFixed(2);
    }
    const text = (field: keyof Cur & keyof InvoiceInsert, value: string | null, label: string, ok: (v: string) => boolean = () => true) => {
      if (value && ok(value) && value !== (cur[field] ?? null)) {
        (set as Record<string, unknown>)[field] = value; why.push(label);
        example(label, `${cur.invoiceNo}: "${cur[field] ?? ""}" → "${value}"`);
      }
    };
    text("mrnNo", str(r["MRN NO"]), "MRN", (v) => /^[A-Za-z0-9\-\/ ]{3,30}$/.test(v));
    const caseType = str(r["CASE"]);
    if (caseType && !/TOTAL/i.test(caseType) && caseType !== (cur.caseType ?? null)) {
      set.caseType = caseType; why.push("case type");
      example("case type", `${cur.invoiceNo}: "${cur.caseType ?? ""}" → "${caseType}"`);
      // its case-type category follows (the other categories are kept), and so does its imported DO (below)
      set.categoryIds = withCaseCats(cur.organizationId, (cur.categoryIds as string[] | null) ?? [], caseType);
      caseTypeChanges.push({ invoiceId: cur.id, doId: cur.deliveryOrderId, orgId: cur.organizationId, from: cur.caseType, to: caseType });
    }
    // only a real change: "02:00:00 PM" and "02:00:00 pm" are the same time
    const time = str(r["TIME"]);
    if (time && time.toLowerCase() !== (cur.caseTime ?? "").toLowerCase()) { set.caseTime = time; why.push("case time"); example("case time", `${cur.invoiceNo}: "${cur.caseTime ?? ""}" → "${time}"`); }
    text("customerPoNo", str(r["LPO"]), "LPO", (v) => !looksLikeMoney(v));
    text("salesOrderNo", str(r["SALES ORDER NO"]), "SO no", (v) => !looksLikeMoney(v));
    // Sales person: the system holds the staff account each invoice is credited to ("Zilarahim"), the sheet a team
    // label ("Iwan & Zila") that is no account. Not overwritten; only counted for the report.
    const sp = str(r["Sales Person"]);
    if (sp && sp !== cur.salesPersonName && sp !== cur.applicationSpecialistName) salesPersonDiffers++;
    // the case date is also the invoice date of imported invoices (see the insert above)
    const d = toDate(r["DATE"]);
    if (d && sheetDay(d) !== klDay(cur.caseDate)) { set.caseDate = d; why.push("case date"); example("case date", `${cur.invoiceNo}: ${klDay(cur.caseDate)} → ${sheetDay(d)}`); }
    if (d && sheetDay(d) !== klDay(cur.invoiceDate)) { set.invoiceDate = d; why.push("invoice date"); example("invoice date", `${cur.invoiceNo}: ${klDay(cur.invoiceDate)} → ${sheetDay(d)}`); }
    // the surgeon (customer) and hospital
    const surgeonRaw = str(r["SURGEON"]);
    if (surgeonRaw) {
      const c = customerByName.get(normalizeSurgeon(surgeonRaw).name);
      if (c) {
        const snap = snapshotFor(c.id, str(r["HOSPITAL"]));
        const curSnap = (cur.customerSnapshot ?? {}) as { name?: string; organizationName?: string };
        if (c.id !== cur.customerId) { set.customerId = c.id; set.customerSnapshot = snap; why.push("surgeon"); example("surgeon", `${cur.invoiceNo}: "${curSnap.name ?? ""}" → "${snap?.name ?? ""}"`); }
        // the hospital: only a real change. The system often has the sheet's own wording ("Gleneagles Medini") where the
        // customer's hospital record has its full name ("Gleneagles Hospital Medini Johor"); that is the same hospital.
        else if (snap?.organizationName && ![snap.organizationName, str(r["HOSPITAL"]), normalizeHospital(str(r["HOSPITAL"]) ?? "")]
          .some((n) => n && n.toLowerCase() === (curSnap.organizationName ?? "").toLowerCase())) {
          set.customerSnapshot = snap; why.push("hospital");
          example("hospital", `${cur.invoiceNo}: "${curSnap.organizationName ?? ""}" → "${snap.organizationName}" (sheet: "${str(r["HOSPITAL"]) ?? ""}")`);
        }
      }
    }
  }
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

    // An invoice imported before its surgeon was a customer has no customer: link it now that the customer exists
    // (with the hospital the sheet names), and its DO too (below). Always, not only with --sheet-wins.
    if (!cur.customerId) {
      const surgeonRaw = str(r["SURGEON"]);
      const c = surgeonRaw ? customerByName.get(normalizeSurgeon(surgeonRaw).name) : undefined;
      if (c) {
        const snap = snapshotFor(c.id, str(r["HOSPITAL"]));
        set.customerId = c.id; set.customerSnapshot = snap; why.push("customer link");
        example("customer link", `${cur.invoiceNo}: → "${snap?.name ?? c.name}" at "${snap?.organizationName ?? "-"}"`);
        customerLinks.push({ doId: cur.deliveryOrderId, customerId: c.id, snapshot: snap });
      }
    }

    if (SHEET_WINS) sheetWins(cur, r, set, why);

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
  if (examples.size) {
    console.log("  examples (system → sheet):");
    for (const [label, lines] of examples) for (const l of lines) console.log(`   [${label}] ${l}`);
  }
  console.log(`New delivery orders:     ${doInserts.length}`);
  console.log(`DO links to (re)attach:  ${doLinks.length - doInserts.length} existing DO(s) matched by number`);
  console.log(`DO status updates:       ${doStatusUpdates.length}  ${JSON.stringify(tally(doStatusUpdates.map((d) => `${d.from}→${d.to}`)))}`);

  console.log(`Customer links:          ${customerLinks.length}  (invoices that had no customer; their DOs follow)`);
  if (SHEET_WINS) {
    console.log(`Case type changes:       ${caseTypeChanges.length}  (their category and imported DO follow)`);
    console.log(`Sales person differs:    ${salesPersonDiffers}  (kept: the system has the staff account, the sheet a team label)`);
  }

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

  // an invoice that got its customer now: its DO gets it too, if it has none (a customer set in the app is kept)
  let doCustomerLinked = 0;
  for (const l of customerLinks) {
    if (!l.doId) continue;
    const res = await db.update(deliveryOrder).set({ customerId: l.customerId, customerSnapshot: l.snapshot })
      .where(and(eq(deliveryOrder.id, l.doId), isNull(deliveryOrder.customerId))).returning({ id: deliveryOrder.id });
    doCustomerLinked += res.length;
  }
  if (customerLinks.length) console.log(`✓ customer linked on ${customerLinks.length} invoices and ${doCustomerLinked} delivery orders`);

  // a changed case type: the imported DO's item (it is the case type) and its case-type category follow
  let doCaseUpdated = 0;
  for (const ch of caseTypeChanges) {
    if (!ch.doId) continue;
    const [d] = await db.select({ id: deliveryOrder.id, isCaseDo: deliveryOrder.isCaseDo, categoryIds: deliveryOrder.categoryIds }).from(deliveryOrder).where(eq(deliveryOrder.id, ch.doId));
    if (!d || d.isCaseDo) continue; // a DO made in the app is not the import's to change
    await db.update(deliveryOrder).set({ categoryIds: withCaseCats(ch.orgId, d.categoryIds ?? [], ch.to) }).where(eq(deliveryOrder.id, d.id));
    if (ch.from) {
      await db.update(deliveryOrderItem).set({ description: ch.to })
        .where(and(eq(deliveryOrderItem.deliveryOrderId, d.id), eq(deliveryOrderItem.description, ch.from)));
    }
    doCaseUpdated++;
  }
  if (caseTypeChanges.length) console.log(`✓ case type followed on ${doCaseUpdated} delivery orders`);

  // the invoice list's figures (billed, collected, outstanding …) are a saved summary: refresh it for both companies
  for (const orgId of ALL_ORG_IDS) {
    const rows = await db.select({ status: invoice.status, grandTotal: invoice.grandTotal, paidAmount: invoice.paidAmount, soaVerified: invoice.soaVerified })
      .from(invoice).where(eq(invoice.organizationId, orgId));
    const s = computeInvoiceStats(rows);
    await db.insert(invoiceStats).values({ id: nanoid(), organizationId: orgId, ...s })
      .onConflictDoUpdate({ target: invoiceStats.organizationId, set: { ...s, updatedAt: new Date() } });
  }
  console.log(`✓ refreshed the invoice summary figures of ${ALL_ORG_IDS.length} companies`);

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
