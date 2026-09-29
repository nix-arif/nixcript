/**
 * Merge a duplicate customer_organization into the canonical one.
 *
 * Re-points every reference from the duplicate (--from) to the canonical row
 * (--into), then deletes the duplicate — atomically (single transaction):
 *   - customer_company.customer_organization_id   (customer ↔ hospital links)
 *   - purchase_order_item.customer_organization_id
 *   - packing_list_item.customer_organization_id
 * A customer linked to BOTH orgs keeps one link (primary if either was).
 * The canonical row's empty address/phone/email are filled from the duplicate.
 *
 * Issued documents are deliberately NOT touched: quotation / SO / DO /
 * invoice / CPO / consignment `customer_snapshot` keeps the name the document
 * was issued with.
 *
 * Also add the duplicate's name to HOSPITAL_ALIASES in scripts/seed-config.ts
 * if it came from the case sheet, or sync-case-sheet.ts will recreate it.
 *
 * --name "<final name>" also renames the kept org in the same transaction
 * (e.g. keep the row that has the address, but under the other row's name).
 *
 * Dry run (default — prints the plan, changes nothing):
 *   npx dotenv -e .env.local -- npx tsx scripts/merge-customer-org.ts --from <dupId> --into <keepId>
 * Apply:
 *   npx dotenv -e .env.local -- npx tsx scripts/merge-customer-org.ts --from <dupId> --into <keepId> --apply
 * (use -e .env for production — back it up first)
 */
import { neon } from "@neondatabase/serverless";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const fromId = arg("from");
  const intoId = arg("into");
  const apply = process.argv.includes("--apply");
  const newName = arg("name")?.trim();
  if (!fromId || !intoId || fromId === intoId) {
    throw new Error("Usage: --from <duplicateOrgId> --into <canonicalOrgId> [--apply]");
  }

  const sql = neon(process.env.DATABASE_URL!);
  const host = new URL(process.env.DATABASE_URL!).host.replace(/-pooler/, "");
  console.log(`Database: ${host}   Mode: ${apply ? "APPLY" : "dry run"}\n`);

  const orgs = await sql`
    SELECT id, organization_id, name, address, phone, email
    FROM customer_organization WHERE id IN (${fromId}, ${intoId})`;
  const from = orgs.find((o) => o.id === fromId);
  const into = orgs.find((o) => o.id === intoId);
  if (!from) throw new Error(`--from org ${fromId} not found`);
  if (!into) throw new Error(`--into org ${intoId} not found`);
  if (from.organization_id !== into.organization_id) {
    // Different companies are OK only when one person owns both — the app
    // already shares customer organisations across an owner's companies.
    const owners = await sql`
      SELECT organization_id, user_id FROM member
      WHERE role = 'owner' AND organization_id IN (${from.organization_id}, ${into.organization_id})`;
    const ownerOf = (org: string) => new Set(owners.filter((o) => o.organization_id === org).map((o) => o.user_id));
    const a = ownerOf(from.organization_id), b = ownerOf(into.organization_id);
    if (![...a].some((u) => b.has(u))) {
      throw new Error("Orgs belong to companies with different owners — refusing to merge");
    }
    console.log("(Cross-company merge: both companies have the same owner.)");
  }
  console.log(`Merge  "${from.name}" (${fromId})\n into  "${into.name}" (${intoId})\n`);

  const links = await sql`
    SELECT cc.id, cc.customer_id, c.name AS customer, cc.customer_organization_id AS org, cc.is_primary
    FROM customer_company cc JOIN customer c ON c.id = cc.customer_id
    WHERE cc.customer_organization_id IN (${fromId}, ${intoId})`;
  const fromLinks = links.filter((l) => l.org === fromId);
  const intoByCustomer = new Map(links.filter((l) => l.org === intoId).map((l) => [l.customer_id, l]));
  const toMove = fromLinks.filter((l) => !intoByCustomer.has(l.customer_id));
  const toDrop = fromLinks.filter((l) => intoByCustomer.has(l.customer_id));

  const [{ n: poItems }] = await sql`SELECT count(*)::int AS n FROM purchase_order_item WHERE customer_organization_id = ${fromId}`;
  const [{ n: plItems }] = await sql`SELECT count(*)::int AS n FROM packing_list_item WHERE customer_organization_id = ${fromId}`;

  const fill = {
    address: !into.address?.trim() && from.address?.trim() ? from.address : null,
    phone: !into.phone?.trim() && from.phone?.trim() ? from.phone : null,
    email: !into.email?.trim() && from.email?.trim() ? from.email : null,
  };

  console.log("Plan:");
  for (const l of toMove) console.log(`  • move link: ${l.customer}${l.is_primary ? " (primary)" : ""}`);
  for (const l of toDrop) console.log(`  • drop duplicate link (already on target): ${l.customer}`);
  console.log(`  • purchase_order_item rows re-pointed: ${poItems}`);
  console.log(`  • packing_list_item rows re-pointed:   ${plItems}`);
  for (const [k, v] of Object.entries(fill)) if (v) console.log(`  • fill target ${k} from duplicate: ${v}`);
  console.log(`  • delete duplicate org "${from.name}"`);
  if (newName && newName !== into.name) console.log(`  • rename kept org "${into.name}" → "${newName}"`);

  if (!apply) {
    console.log("\nDry run only — re-run with --apply to make these changes.");
    return;
  }

  const queries = [
    // Keep "primary" when merging a customer that was linked to both
    ...toDrop
      .filter((l) => l.is_primary)
      .map((l) => sql`UPDATE customer_company SET is_primary = true WHERE id = ${intoByCustomer.get(l.customer_id)!.id}`),
    ...(toDrop.length ? [sql`DELETE FROM customer_company WHERE id = ANY(${toDrop.map((l) => l.id)})`] : []),
    sql`UPDATE customer_company SET customer_organization_id = ${intoId} WHERE customer_organization_id = ${fromId}`,
    sql`UPDATE purchase_order_item SET customer_organization_id = ${intoId} WHERE customer_organization_id = ${fromId}`,
    sql`UPDATE packing_list_item SET customer_organization_id = ${intoId} WHERE customer_organization_id = ${fromId}`,
    sql`UPDATE customer_organization SET
          address = COALESCE(${fill.address}, address),
          phone   = COALESCE(${fill.phone}, phone),
          email   = COALESCE(${fill.email}, email),
          updated_at = now()
        WHERE id = ${intoId}`,
    sql`DELETE FROM customer_organization WHERE id = ${fromId}`,
    // Rename after the delete so the duplicate's name is free under the
    // unique (organization_id, name) index.
    ...(newName && newName !== into.name
      ? [sql`UPDATE customer_organization SET name = ${newName}, updated_at = now() WHERE id = ${intoId}`]
      : []),
  ];
  await sql.transaction(queries);

  const after = await sql`
    SELECT co.id, co.name, (SELECT count(*)::int FROM customer_company cc WHERE cc.customer_organization_id = co.id) AS members
    FROM customer_organization co WHERE co.id IN (${fromId}, ${intoId})`;
  console.log("\n✓ Applied. Now:", after.map((r) => `"${r.name}" — ${r.members} linked customer(s)`).join("; "));
  console.log(`  Duplicate row still exists: ${after.some((r) => r.id === fromId) ? "YES (unexpected!)" : "no"}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
