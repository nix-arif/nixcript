/**
 * Adds the Case Detail sheet's invoices that aren't in the system yet — each with its DO, its
 * commission row and its categories — the same way scripts/sync-case-sheet.ts creates them, but
 * ADD-ONLY: nothing that exists is changed or deleted (that script rebuilds every DO, commission,
 * category and hospital link for both companies, which would wipe edits made since).
 *
 *   - customer: the surgeon, matched by name as the sync does; a surgeon not found yet is created
 *   - hospital: the sheet's (alias-normalized), with its address; linked to the surgeon if new
 *   - invoice + DO (DO number from the invoice number), DO line = the case type, categories =
 *     private + laser + the case type's; the DO counter is raised to the highest number
 *
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/sync-missing-case-invoices.ts           # dry run
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/sync-missing-case-invoices.ts --apply
 */

import { createSign } from "crypto";
import { nanoid } from "nanoid";
import { neon } from "@neondatabase/serverless";
import {
  ORG, ALL_ORG_IDS, CREATED_BY, resolveOrgId,
  normalizeSurgeon, normalizeHospital, str, toMoney, toDate, mapStatus,
} from "./seed-config";

const apply = process.argv.includes("--apply");
const SHEET_ID = "1q4-AlIajvMSloO_4dsnerTaKU-Yy1GrgeXqlLsq_AIA";
const TAB_NAME = "Case Detail";

// ── sheet (service account, as sync-case-sheet.ts) ──────────────────────────
const cleanKey = (raw: string) => raw.trim().replace(/^"/, "").replace(/",?$/, "").replace(/\\n/g, "\n");
async function accessToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!, key = cleanKey(process.env.GOOGLE_PRIVATE_KEY ?? "");
  if (!email || !key) throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY missing");
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const p = Buffer.from(JSON.stringify({ iss: email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly", aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now })).toString("base64url");
  const s = createSign("RSA-SHA256"); s.update(`${h}.${p}`);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${h}.${p}.${s.sign(key, "base64url")}` }),
  });
  const d = await res.json();
  if (!d.access_token) throw new Error(`Google auth failed: ${d.error_description ?? JSON.stringify(d)}`);
  return d.access_token;
}
async function sheetRows(): Promise<Record<string, string>[]> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/'${TAB_NAME}'!A1:BA3000`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(`Sheets API error: ${JSON.stringify(data)}`);
  const rows: string[][] = data.values ?? [];
  // headers trimmed (" Sales Person"); a repeated header (the 2nd PAYMENT DATE) gets _1, as the sync expects
  const seen = new Map<string, number>();
  const headers = (rows[0] ?? []).map((raw) => {
    const h = raw.trim(); if (!h) return "";
    const n = seen.get(h) ?? 0; seen.set(h, n + 1);
    return n === 0 ? h : `${h}_${n}`;
  });
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { if (h) o[h] = r[i] ?? ""; });
    if (!o["Sales Person"] && r[7]) o["Sales Person"] = r[7];
    return o;
  });
}

const orgOf = (company: unknown, invoiceNo: string) =>
  resolveOrgId(company) ?? (/^INVAF\//i.test(invoiceNo) ? ORG.affirma : /^INVSI\//i.test(invoiceNo) ? ORG.innosys : null);
const doStatus = (s: string) => (s === "paid" || s === "sent" || s === "overdue" ? "delivered" : s === "cancelled" ? "returned" : "draft");
function caseCategories(caseType: string | null): string[] {
  if (!caseType) return [];
  const map: Record<string, string> = { EVLT: "evlt", MILH: "milh", PLDD: "pldd", RFA: "rfa", FISTULA: "filac", FILAC: "filac", SILAC: "silac" };
  return [...new Set(caseType.toUpperCase().split(/[&,/]+/).map((p) => map[p.trim()]).filter(Boolean))];
}

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  console.log(`DB: ${new URL(process.env.DATABASE_URL!).host}  (${apply ? "APPLY" : "dry run — nothing is written"})`);
  const orgIds = [...ALL_ORG_IDS] as string[];

  const rows = (await sheetRows()).filter((r) => str(r["INVOICE NO"]));
  const grouped = new Map<string, { orgId: string; invoiceNo: string; all: Record<string, string>[] }>();
  for (const r of rows) {
    const invoiceNo = str(r["INVOICE NO"])!;
    const orgId = orgOf(r["COMPANY"], invoiceNo);
    if (!orgId) continue;
    const key = `${orgId}|${invoiceNo}`;
    if (!grouped.has(key)) grouped.set(key, { orgId, invoiceNo, all: [] });
    grouped.get(key)!.all.push(r);
  }

  const existing = new Set((await sql`select organization_id, invoice_no from invoice where organization_id = any(${orgIds})`).map((x: any) => `${x.organization_id}|${x.invoice_no}`));
  const existingDo = new Set((await sql`select organization_id, do_no from delivery_order where organization_id = any(${orgIds})`).map((x: any) => `${x.organization_id}|${x.do_no}`));
  const missing = [...grouped.values()].filter((g) => !existing.has(`${g.orgId}|${g.invoiceNo}`));
  console.log(`Sheet invoices: ${grouped.size} · in the system: ${existing.size} · missing: ${missing.length}`);
  if (missing.length === 0) return;

  const customers = await sql`select id, organization_id, title, name, contact_no, email from customer where organization_id = any(${orgIds})`;
  const custByName = new Map(customers.map((c: any) => [c.name, c]));
  const hospitals = await sql`select id, organization_id, name, address from customer_organization where organization_id = any(${orgIds})`;
  const hospByName = new Map<string, any>();
  for (const h of hospitals as any[]) if (!hospByName.has(h.name.toLowerCase())) hospByName.set(h.name.toLowerCase(), h);
  const links = await sql`select customer_id, customer_organization_id from customer_company`;
  const linked = new Set(links.map((l: any) => `${l.customer_id}|${l.customer_organization_id}`));
  const cats = await sql`select id, organization_id, lower(name) as name from document_category where organization_id = any(${orgIds})`;
  const catId = new Map(cats.map((c: any) => [`${c.organization_id}|${c.name}`, c.id]));

  const plan: string[] = [];
  const warnings: string[] = [];
  const maxDo = new Map<string, { year: number; n: number }>();

  for (const g of missing) {
    const r = g.all[0];
    const pick = (f: string) => g.all.map((x) => str(x[f])).find((v) => v != null) ?? null;
    const pickMoney = (f: string) => g.all.map((x) => toMoney(x[f])).find((v) => Number(v) > 0) ?? "0";
    const pickDate = (f: string) => g.all.map((x) => toDate(x[f])).find((v) => v != null) ?? null;
    const doNo = g.invoiceNo.replace(/^INV/, "DO");
    if (existingDo.has(`${g.orgId}|${doNo}`)) { warnings.push(`${g.invoiceNo}: skipped — ${doNo} already exists`); continue; }

    // surgeon
    const surgeonRaw = str(r["SURGEON"]);
    let cust: any = null;
    if (surgeonRaw) {
      const { title, name } = normalizeSurgeon(surgeonRaw);
      cust = custByName.get(name);
      if (!cust) {
        cust = { id: nanoid(), organization_id: g.orgId, title, name, contact_no: str(r["CONTACT NO"]), email: null, _new: true };
        custByName.set(name, cust);
        warnings.push(`${g.invoiceNo}: new customer "${name}" (sheet: "${surgeonRaw}")`);
        if (apply) await sql`insert into customer (id, organization_id, title, name, organization_name, contact_no, created_by) values (${cust.id}, ${g.orgId}, ${title}, ${name}, ${normalizeHospital(str(r["HOSPITAL"]) ?? "")}, ${cust.contact_no}, ${CREATED_BY})`;
      }
    } else warnings.push(`${g.invoiceNo}: no surgeon on the sheet`);

    // hospital (with its address) and the surgeon's link to it
    const hospName = str(r["HOSPITAL"]) ? normalizeHospital(str(r["HOSPITAL"])!) : null;
    let hosp: any = hospName ? hospByName.get(hospName.toLowerCase()) : null;
    if (hospName && !hosp) {
      hosp = { id: nanoid(), organization_id: cust?.organization_id ?? g.orgId, name: hospName, address: null };
      hospByName.set(hospName.toLowerCase(), hosp);
      warnings.push(`${g.invoiceNo}: new hospital "${hospName}" (no address yet)`);
      if (apply) await sql`insert into customer_organization (id, organization_id, name) values (${hosp.id}, ${hosp.organization_id}, ${hospName})`;
    }
    if (cust && hosp && !linked.has(`${cust.id}|${hosp.id}`)) {
      linked.add(`${cust.id}|${hosp.id}`);
      warnings.push(`${g.invoiceNo}: links ${cust.name} to ${hosp.name}`);
      const hasAny = [...linked].some((k) => k.startsWith(`${cust.id}|`) && k !== `${cust.id}|${hosp.id}`);
      if (apply) await sql`insert into customer_company (id, customer_id, customer_organization_id, is_primary) values (${nanoid()}, ${cust.id}, ${hosp.id}, ${!hasAny})`;
    }
    const snapshot = cust ? {
      ...(cust.title ? { title: cust.title } : {}), name: cust.name,
      ...(cust.email ? { email: cust.email } : {}), ...(cust.contact_no ? { contactNo: cust.contact_no } : {}),
      ...(hosp ? { organizationName: hosp.name } : {}), ...(hosp?.address ? { organizationAddress: hosp.address } : {}),
    } : null;

    // the invoice
    const caseDate = toDate(r["DATE"]) ?? null;
    if (!caseDate) warnings.push(`${g.invoiceNo}: no case date on the sheet (dated today)`);
    const invDate = caseDate ?? new Date();
    const status = mapStatus(str(r["STATUS"]) ?? "");
    const total = toMoney(r["TOTAL SO"]);
    if (Number(total) <= 0) warnings.push(`${g.invoiceNo}: no amount on the sheet (RM 0.00)`);
    const caseType = str(r["CASE"]);
    const categoryIds = ["private", "laser", ...caseCategories(caseType)].map((n) => catId.get(`${g.orgId}|${n}`)).filter(Boolean) as string[];
    const billTo = str(r["INNOSYS BILL TO AFFIRMA"]);
    const invId = nanoid(), doId = nanoid();
    const sales = str(r["Sales Person"]);

    plan.push(`${g.invoiceNo} / ${doNo} · ${invDate.toLocaleDateString("en-MY")} · ${snapshot?.name ?? "—"} · ${hosp?.name ?? "—"} · ${caseType ?? "—"} · RM ${Number(total).toFixed(2)} · ${status}`);

    const m = /(\d{2})-(\d{4})$/.exec(doNo);
    if (m) { const y = 2000 + Number(m[1]), n = Number(m[2]); const cur = maxDo.get(g.orgId); if (!cur || y > cur.year || (y === cur.year && n > cur.n)) maxDo.set(g.orgId, { year: y, n }); }

    if (!apply) continue;
    await sql`insert into delivery_order (id, organization_id, do_no, sales_order_no, customer_po_no, customer_id, customer_snapshot, delivered_to, delivery_address, delivery_date, notes, status, created_by, category_ids)
      values (${doId}, ${g.orgId}, ${doNo}, ${str(r["SALES ORDER NO"])}, ${str(r["LPO"])}, ${cust?.id ?? null}, ${snapshot ? JSON.stringify(snapshot) : null}::json, ${snapshot?.name ?? null}, ${hosp?.address ?? null}, ${invDate}, ${billTo ? `Innosys bill to Affirma: ${billTo}` : null}, ${doStatus(status)}, ${CREATED_BY}, ${JSON.stringify(categoryIds)}::json)`;
    if (caseType) await sql`insert into delivery_order_item (id, delivery_order_id, row_no, description, qty) values (${nanoid()}, ${doId}, 1, ${caseType}, '1')`;
    await sql`insert into invoice (id, organization_id, invoice_no, invoice_date, sales_person_name, application_specialist_name, customer_id, customer_snapshot, customer_po_no, sales_order_no, grand_total, subtotal, status, paid_at, payment_ref, soa_verified, case_date, case_type, case_time, mrn_no, notes, created_by, category_ids, delivery_order_id, delivery_order_no)
      values (${invId}, ${g.orgId}, ${g.invoiceNo}, ${invDate}, ${sales}, ${sales}, ${cust?.id ?? null}, ${snapshot ? JSON.stringify(snapshot) : null}::json, ${str(r["LPO"])}, ${str(r["SALES ORDER NO"])}, ${total}, ${total}, ${status}, ${toDate(r["PAYMENT DATE"]) ?? null}, ${str(r["PAYMENT REF"])}, ${false}, ${caseDate}, ${caseType}, ${str(r["TIME"])}, ${str(r["MRN NO"])}, ${billTo ? `Innosys bill to Affirma: ${billTo}` : null}, ${CREATED_BY}, ${JSON.stringify(categoryIds)}::json, ${doId}, ${doNo})`;
    // commission (as the sync: only when the sheet has something for it)
    const claimedBy = pick("ATTEND COMMISSION CLAIM BY"), docs = pick("DOCS");
    const attend = pickMoney("COMMISSION AMOUNT"), surgeon = pickMoney("SURGEON COMMISSION"), surgeonPaid = pickDate("PAYMENT DATE_1");
    const incentive = pickMoney("Incentive"), actual = pickMoney("Actual Amount");
    if (claimedBy || docs || Number(attend) > 0 || Number(surgeon) > 0 || surgeonPaid || Number(incentive) > 0 || Number(actual) > 0)
      await sql`insert into case_commission (id, invoice_id, organization_id, claimed_by, docs, attend_amount, surgeon_amount, surgeon_paid_at, incentive, actual_amount)
        values (${nanoid()}, ${invId}, ${g.orgId}, ${claimedBy}, ${docs}, ${attend}, ${surgeon}, ${surgeonPaid}, ${incentive}, ${actual})`;
  }

  console.log(`\n${apply ? "Added" : "Would add"} ${plan.length} invoices with their DOs:`);
  for (const p of plan) console.log("  " + p);
  if (warnings.length) { console.log(`\nNotes (${warnings.length}):`); for (const w of warnings) console.log("  " + w); }

  for (const [orgId, { year, n }] of maxDo) {
    const [c] = await sql`select year, last_number from delivery_order_counter where organization_id = ${orgId}`;
    const raise = !c || year > c.year || (year === c.year && n > c.last_number);
    console.log(`DO counter ${orgId === ORG.innosys ? "Smart Innosys" : "Affirma"}: ${c ? `${c.year}/${c.last_number}` : "none"} → ${raise ? `${year}/${n}` : "unchanged"}`);
    if (apply && raise) {
      if (c) await sql`update delivery_order_counter set year = ${year}, last_number = ${n}, updated_at = now() where organization_id = ${orgId}`;
      else await sql`insert into delivery_order_counter (id, organization_id, year, last_number, updated_at) values (${nanoid()}, ${orgId}, ${year}, ${n}, now())`;
    }
  }
}

main().then(() => process.exit(0), (e) => { console.error("FAILED:", e); process.exit(1); });
