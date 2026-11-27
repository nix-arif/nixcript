/**
 * Applies the Zilarahim / syahidahsubari rule (scripts/staff-match.ts applyPairRule) to the case invoices:
 * a case on or after syahidahsubari's hire date that involves either of them gets syahidahsubari as the
 * sales person (first in the sales persons list, others kept) and Zilarahim as the application
 * specialist; earlier cases are left as they are. Their pending allowances are worked out again as the
 * app does (paid / payslipped ones are never touched).
 *
 *   npx dotenv-cli -e .env -- npx tsx scripts/apply-pair-rule.ts            # dry run
 *   npx dotenv-cli -e .env -- npx tsx scripts/apply-pair-rule.ts --apply
 */
import { neon } from "@neondatabase/serverless";
import { ALL_ORG_IDS } from "./seed-config";
import { applyPairRule, PAIR, type Staff } from "./staff-match";

const apply = process.argv.includes("--apply");

(async () => {
  const sql = neon(process.env.DATABASE_URL!);
  const orgIds = [...ALL_ORG_IDS] as string[];
  console.log(`DB: ${new URL(process.env.DATABASE_URL!).host}  (${apply ? "APPLY" : "dry run — nothing is written"})`);
  const staff = (await sql`select id, name from "user" where lower(name) in (${PAIR.sales.toLowerCase()}, ${PAIR.specialist.toLowerCase()})`) as Staff[];
  const [{ from }] = await sql`select to_char(min(m.hire_date), 'YYYY-MM-DD') as from from member m join "user" u on u.id = m.user_id where lower(u.name) = ${PAIR.sales.toLowerCase()} and m.hire_date is not null`;
  console.log(`${PAIR.sales} hire date: ${from ?? "none — nothing to do"}`);
  if (!from) process.exit(0);

  const invs = await sql`select id, invoice_no, sales_person_id, sales_person_name, application_specialist_id, application_specialist_name, associate_sales_persons,
      to_char((coalesce(case_date, invoice_date) at time zone 'UTC') at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') as day
    from invoice where organization_id = any(${orgIds})`;
  const todo: { id: string; no: string; sales: Staff[]; spec: Staff }[] = [];
  const kinds = new Map<string, number>();
  for (const i of invs as any[]) {
    const list: Staff[] = (Array.isArray(i.associate_sales_persons) ? i.associate_sales_persons : []).filter((p: any) => p?.id).map((p: any) => ({ id: p.id, name: p.name }));
    const sales = list.length ? list : i.sales_person_id ? [{ id: i.sales_person_id, name: i.sales_person_name }] : [];
    if (i.sales_person_id && !sales.some((p) => p.id === i.sales_person_id)) sales.unshift({ id: i.sales_person_id, name: i.sales_person_name });
    const before = { sales, specialist: i.application_specialist_id ? { id: i.application_specialist_id, name: i.application_specialist_name } : null };
    const after = applyPairRule(before, i.day, from, staff);
    const same = after.specialist?.id === before.specialist?.id && after.sales.map((p) => p.id).join() === before.sales.map((p) => p.id).join() && (i.sales_person_id ?? null) === (after.sales[0]?.id ?? null);
    if (same) continue;
    todo.push({ id: i.id, no: i.invoice_no, sales: after.sales, spec: after.specialist! });
    const k = `${before.sales.map((p) => p.name).join("+") || "—"} / ${before.specialist?.name ?? "—"}  →  ${after.sales.map((p) => p.name).join("+")} / ${after.specialist?.name}`;
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
  }
  console.log(`\n${apply ? "Changing" : "Would change"} ${todo.length} invoices (sales person(s) / application specialist):`);
  for (const [k, n] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`);
  if (!apply || todo.length === 0) process.exit(0);

  for (const t of todo)
    await sql`update invoice set sales_person_id = ${t.sales[0].id}, sales_person_name = ${t.sales[0].name},
      associate_sales_persons = ${JSON.stringify(t.sales.map((p) => ({ id: p.id, name: p.name })))}::json,
      application_specialist_id = ${t.spec.id}, application_specialist_name = ${t.spec.name}, updated_at = now() where id = ${t.id}`;
  const { recomputeInvoiceAllowances } = await import("../server/invoice-allowance");
  for (const t of todo) await recomputeInvoiceAllowances(t.id);
  const locked = await sql`select count(distinct invoice_id)::int as n from invoice_allowance where invoice_id = any(${todo.map((t) => t.id)}) and (status = 'paid' or payslip_id is not null)`;
  console.log(`✓ changed ${todo.length} invoices; allowances worked out again (${locked[0].n} with paid / payslipped allowances were left as they were)`);
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
