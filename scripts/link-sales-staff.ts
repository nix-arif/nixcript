/**
 * Links the case invoices whose sales person is only a name to the staff account(s) it stands for
 * (scripts/staff-match.ts: "Zila" → Zilarahim, "syahidah" → syahidahsubari, an exact or unique-prefix
 * username, and a two-person label "Hadif ( Ziyad )" → both), then works out their pending allowances
 * as the app does (recomputeInvoiceAllowances). Staff of any of the owner's companies count (a case is
 * often covered by someone from a sibling company).
 *
 * As the other linked invoices: the sales person is the first person and the sales persons list
 * (associate_sales_persons) has everyone, the first included. One person is also the application
 * specialist; a two-person label is two sales persons and no application specialist. A label with
 * a name that has no account stays as text. Invoices already linked only get the list filled in when
 * it is empty.
 *
 *   npx dotenv-cli -e .env -- npx tsx scripts/link-sales-staff.ts            # dry run
 *   npx dotenv-cli -e .env -- npx tsx scripts/link-sales-staff.ts --apply
 */

import { neon } from "@neondatabase/serverless";
import { ORG, ALL_ORG_IDS } from "./seed-config";
import { staffListMatcher, type Staff } from "./staff-match";

const apply = process.argv.includes("--apply");

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const orgIds = [...ALL_ORG_IDS] as string[];
  console.log(`DB: ${new URL(process.env.DATABASE_URL!).host}  (${apply ? "APPLY" : "dry run — nothing is written"})`);

  // the staff of every company the same owner has (as lib/org/owner-orgs.ts)
  const staff = (await sql`
    with owner as (select user_id from member where organization_id = ${ORG.innosys} and role = 'owner' and deleted_at is null limit 1),
    orgs as (select organization_id from member where user_id = (select user_id from owner) and role = 'owner' and deleted_at is null
             union select unnest(${orgIds}::text[]))
    select distinct u.id, u.name from member m join "user" u on u.id = m.user_id
    where m.organization_id in (select organization_id from orgs)`) as Staff[]; // former members too: their earlier cases are theirs
  const match = staffListMatcher(staff);

  const invs = await sql`select id, invoice_no, sales_person_id, sales_person_name, application_specialist_id, application_specialist_name, associate_sales_persons
    from invoice where organization_id = any(${orgIds})`;

  type Todo = { id: string; no: string; set: Record<string, unknown>; label: string; recompute: boolean };
  const todo: Todo[] = [];
  const counts = new Map<string, number>();
  const unmatched = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  for (const i of invs as any[]) {
    const assoc = Array.isArray(i.associate_sales_persons) ? i.associate_sales_persons : [];
    if (!i.sales_person_id) {
      if (!i.sales_person_name) continue;
      const people = match(i.sales_person_name);
      if (!people) { bump(unmatched, i.sales_person_name); continue; }
      const first = people[0];
      const set: Record<string, unknown> = {
        sales_person_id: first.id, sales_person_name: first.name,
        associate_sales_persons: people.map((p) => ({ id: p.id, name: p.name })),
      };
      // the application specialist: the one person, when the system has the same label for it. A label naming two
      // people ("Hadif ( Ziyad )") is two sales persons and no application specialist.
      if (people.length > 1) {
        if (!i.application_specialist_id && i.application_specialist_name === i.sales_person_name) { set.application_specialist_id = null; set.application_specialist_name = null; set.clearAs = true; }
      } else if (!i.application_specialist_id && (!i.application_specialist_name || i.application_specialist_name === i.sales_person_name || match(i.application_specialist_name)?.[0]?.id === first.id)) {
        set.application_specialist_id = first.id; set.application_specialist_name = first.name;
      }
      todo.push({ id: i.id, no: i.invoice_no, set, label: i.sales_person_name, recompute: true });
      bump(counts, `${i.sales_person_name} → ${people.map((p) => p.name).join(" + ")}`);
    } else if (assoc.length === 0) {
      // linked, but the sales persons list is empty (the other linked invoices have the first in it)
      todo.push({ id: i.id, no: i.invoice_no, set: { associate_sales_persons: [{ id: i.sales_person_id, name: i.sales_person_name ?? "" }] }, label: "", recompute: false });
      bump(counts, `(already linked: sales persons list filled in)`);
    }
  }

  console.log(`\n${apply ? "Updating" : "Would update"} ${todo.length} invoices:`);
  for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`);
  if (unmatched.size) console.log(`\nKept as text (a name with no account): ${[...unmatched].map(([k, n]) => `${k} (${n})`).join(", ")}`);
  if (!apply || todo.length === 0) return;

  for (const t of todo) {
    const s = t.set as any;
    await sql`update invoice set
      sales_person_id = coalesce(${s.sales_person_id ?? null}, sales_person_id),
      sales_person_name = coalesce(${s.sales_person_name ?? null}, sales_person_name),
      application_specialist_id = case when ${!!s.clearAs} then null else coalesce(${s.application_specialist_id ?? null}, application_specialist_id) end,
      application_specialist_name = case when ${!!s.clearAs} then null else coalesce(${s.application_specialist_name ?? null}, application_specialist_name) end,
      associate_sales_persons = ${JSON.stringify(s.associate_sales_persons)}::json,
      updated_at = now()
      where id = ${t.id}`;
  }
  console.log(`✓ updated ${todo.length} invoices`);

  // pending allowances of the newly linked ones, as the app works them out (paid / payslipped ones are never touched)
  const linked = todo.filter((t) => t.recompute);
  if (linked.length) {
    const { recomputeInvoiceAllowances } = await import("../server/invoice-allowance");
    for (const t of linked) await recomputeInvoiceAllowances(t.id);
    const [{ rows, invoices }] = await sql`select count(*)::int as rows, count(distinct invoice_id)::int as invoices from invoice_allowance where invoice_id = any(${linked.map((t) => t.id)})`;
    console.log(`✓ allowances worked out for ${linked.length} linked invoices: ${rows} allowance rows on ${invoices} of them`);
  }
}

main().then(() => process.exit(0), (e) => { console.error("FAILED:", e); process.exit(1); });
