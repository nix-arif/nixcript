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

import { nanoid } from "nanoid";
import { neon } from "@neondatabase/serverless";
import {
  ORG, ALL_ORG_IDS, CREATED_BY, resolveOrgId,
  normalizeSurgeon, normalizeHospital, str, toMoney, toDate, mapStatus,
} from "./seed-config";
import { sheetRows } from "./case-sheet";
import { applyPairRule, PAIR, staffListMatcher, type Staff } from "./staff-match";

const apply = process.argv.includes("--apply");
// Dates go to the database as ISO strings: a Date is sent as its local wall-clock time, which put
// Malaysia midnight 8 hours late (00:00 UTC instead of 16:00 UTC the day before)
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

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

  // the sales person(s) as the staff account(s) the name stands for ("Zila" → Zilarahim, "Hadif ( Ziyad )" →
  // both), else the sheet's text. Staff of any of the owner's companies, former members too (as link-sales-staff.ts).
  const allStaff = (await sql`
    with orgs as (select organization_id from member where role = 'owner' and deleted_at is null
                  and user_id = (select user_id from member where organization_id = ${ORG.innosys} and role = 'owner' and deleted_at is null limit 1))
    select distinct u.id, u.name from member m join "user" u on u.id = m.user_id
    where m.organization_id in (select organization_id from orgs) or m.organization_id = any(${orgIds})`) as Staff[];
  const staffOf = staffListMatcher(allStaff);
  // Zilarahim / syahidahsubari (staff-match.ts applyPairRule): from her hire date
  const [{ pairFrom }] = await sql`select to_char(min(m.hire_date), 'YYYY-MM-DD') as "pairFrom" from member m join "user" u on u.id = m.user_id where lower(u.name) = ${PAIR.sales.toLowerCase()} and m.hire_date is not null`;
  const newIds: string[] = [];

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
    const salesRaw = str(r["Sales Person"]);
    const matched = staffOf(salesRaw);
    // a label naming two people is two sales persons and no application specialist; one person is both
    const caseDay = caseDate ? `${caseDate.getFullYear()}-${String(caseDate.getMonth() + 1).padStart(2, "0")}-${String(caseDate.getDate()).padStart(2, "0")}` : null;
    const people = matched ? applyPairRule({ sales: matched, specialist: matched.length === 1 ? matched[0] : null }, caseDay, pairFrom, allStaff) : null;
    const salesPeople = people?.sales ?? null;
    const salesAcc = salesPeople?.[0] ?? null;
    const sales = salesAcc?.name ?? salesRaw;
    const spec = people ? people.specialist : null;

    plan.push(`${g.invoiceNo} / ${doNo} · ${invDate.toLocaleDateString("en-MY")} · ${snapshot?.name ?? "—"} · ${hosp?.name ?? "—"} · ${caseType ?? "—"} · RM ${Number(total).toFixed(2)} · ${status}`);

    const m = /(\d{2})-(\d{4})$/.exec(doNo);
    if (m) { const y = 2000 + Number(m[1]), n = Number(m[2]); const cur = maxDo.get(g.orgId); if (!cur || y > cur.year || (y === cur.year && n > cur.n)) maxDo.set(g.orgId, { year: y, n }); }

    if (!apply) continue;
    await sql`insert into delivery_order (id, organization_id, do_no, sales_order_no, customer_po_no, customer_id, customer_snapshot, delivered_to, delivery_address, delivery_date, notes, status, created_by, category_ids)
      values (${doId}, ${g.orgId}, ${doNo}, ${str(r["SALES ORDER NO"])}, ${str(r["LPO"])}, ${cust?.id ?? null}, ${snapshot ? JSON.stringify(snapshot) : null}::json, ${snapshot?.name ?? null}, ${hosp?.address ?? null}, ${iso(invDate)}, ${billTo ? `Innosys bill to Affirma: ${billTo}` : null}, ${doStatus(status)}, ${CREATED_BY}, ${JSON.stringify(categoryIds)}::json)`;
    if (caseType) await sql`insert into delivery_order_item (id, delivery_order_id, row_no, description, qty) values (${nanoid()}, ${doId}, 1, ${caseType}, '1')`;
    await sql`insert into invoice (id, organization_id, invoice_no, invoice_date, sales_person_id, application_specialist_id, associate_sales_persons, sales_person_name, application_specialist_name, customer_id, customer_snapshot, customer_po_no, sales_order_no, grand_total, subtotal, status, paid_at, payment_ref, soa_verified, case_date, case_type, case_time, mrn_no, notes, created_by, category_ids, delivery_order_id, delivery_order_no)
      values (${invId}, ${g.orgId}, ${g.invoiceNo}, ${iso(invDate)}, ${salesAcc?.id ?? null}, ${spec?.id ?? null}, ${JSON.stringify((salesPeople ?? []).map((p) => ({ id: p.id, name: p.name })))}::json, ${sales}, ${spec ? spec.name : matched ? null : salesRaw}, ${cust?.id ?? null}, ${snapshot ? JSON.stringify(snapshot) : null}::json, ${str(r["LPO"])}, ${str(r["SALES ORDER NO"])}, ${total}, ${total}, ${status}, ${iso(toDate(r["PAYMENT DATE"]))}, ${str(r["PAYMENT REF"])}, ${false}, ${iso(caseDate)}, ${caseType}, ${str(r["TIME"])}, ${str(r["MRN NO"])}, ${billTo ? `Innosys bill to Affirma: ${billTo}` : null}, ${CREATED_BY}, ${JSON.stringify(categoryIds)}::json, ${doId}, ${doNo})`;
    newIds.push(invId);
    // commission (as the sync: only when the sheet has something for it)
    const claimedBy = pick("ATTEND COMMISSION CLAIM BY"), docs = pick("DOCS");
    const attend = pickMoney("COMMISSION AMOUNT"), surgeon = pickMoney("SURGEON COMMISSION"), surgeonPaid = pickDate("PAYMENT DATE_1");
    const incentive = pickMoney("Incentive"), actual = pickMoney("Actual Amount");
    if (claimedBy || docs || Number(attend) > 0 || Number(surgeon) > 0 || surgeonPaid || Number(incentive) > 0 || Number(actual) > 0)
      await sql`insert into case_commission (id, invoice_id, organization_id, claimed_by, docs, attend_amount, surgeon_amount, surgeon_paid_at, incentive, actual_amount)
        values (${nanoid()}, ${invId}, ${g.orgId}, ${claimedBy}, ${docs}, ${attend}, ${surgeon}, ${iso(surgeonPaid)}, ${incentive}, ${actual})`;
  }

  // the new invoices' pending allowances, as the app works them out
  if (apply && newIds.length) {
    const { recomputeInvoiceAllowances } = await import("../server/invoice-allowance");
    for (const id of newIds) await recomputeInvoiceAllowances(id);
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
