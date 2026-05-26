/**
 * Merge cross-org duplicate customers.
 * 
 * For surgeons who appear in BOTH Affirma and Innosys Excel rows,
 * we end up with 2 customer records. This script:
 *   1. Picks the "canonical" record (from the org with more Excel rows)
 *   2. Updates quotation.customer_id to point to the canonical
 *   3. Moves any unique hospital affiliations to the canonical
 *   4. Deletes the duplicate
 */

import * as XLSX from "xlsx";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { customer, customerCompany } from "../db/schema";
import { eq, inArray, and } from "drizzle-orm";
import {
  ORG, ALL_ORG_IDS, XLSX_FILE,
  resolveOrgId, normalizeSurgeon, str,
} from "./seed-config";
import { nanoid } from "nanoid";

// ── Count Excel rows per surgeon per org ─────────────────────────────────────
const wb = XLSX.readFile(XLSX_FILE);
const ws = wb.Sheets["Case Detail"];
const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });

// name → { orgId → count }
const excelCounts = new Map<string, Map<string, number>>();
for (const r of rows) {
  if (!str(r["INVOICE NO"])) continue;
  const surgeonRaw = str(r["SURGEON"]);
  const orgId      = resolveOrgId(r["COMPANY"]);
  if (!surgeonRaw || !orgId) continue;
  const { name } = normalizeSurgeon(surgeonRaw);
  if (!excelCounts.has(name)) excelCounts.set(name, new Map());
  const orgMap = excelCounts.get(name)!;
  orgMap.set(orgId, (orgMap.get(orgId) ?? 0) + 1);
}

function canonicalOrg(name: string): string {
  const orgMap = excelCounts.get(name);
  if (!orgMap) return ORG.affirma;
  let max = 0; let best = ORG.affirma;
  for (const [orgId, count] of orgMap) {
    if (count > max) { max = count; best = orgId; }
  }
  return best;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const db = drizzle({ client: neon(process.env.DATABASE_URL!) });

  // Find cross-org duplicates
  const allCustomers = await db
    .select({ id: customer.id, name: customer.name, organizationId: customer.organizationId })
    .from(customer)
    .where(inArray(customer.organizationId, [...ALL_ORG_IDS]));

  // Group by name
  const byName = new Map<string, typeof allCustomers>();
  for (const c of allCustomers) {
    if (!byName.has(c.name)) byName.set(c.name, []);
    byName.get(c.name)!.push(c);
  }

  const duplicates = [...byName.entries()].filter(([, cs]) => cs.length > 1);
  console.log(`Cross-org duplicates found: ${duplicates.length}`);

  for (const [name, records] of duplicates) {
    const canonical = canonicalOrg(name);
    const keep  = records.find(r => r.organizationId === canonical) ?? records[0];
    const dups  = records.filter(r => r.id !== keep.id);

    console.log(`\n"${name}":`);
    console.log(`  KEEP   id=${keep.id}  org=${keep.organizationId === ORG.affirma ? "Affirma" : "Innosys"}`);
    dups.forEach(d => console.log(`  DELETE id=${d.id}  org=${d.organizationId === ORG.affirma ? "Affirma" : "Innosys"}`));

    for (const dup of dups) {
      // 1. Re-point quotations from dup → keep
      const sql = neon(process.env.DATABASE_URL!);
      const updated = await sql`
        UPDATE quotation SET customer_id = ${keep.id}
        WHERE customer_id = ${dup.id}
        RETURNING id
      `;
      if (updated.length > 0) {
        console.log(`  ✓ migrated ${updated.length} quotation(s) → ${keep.id}`);
      }

      // 2. Move unique customerCompany rows to the keep record
      const dupCompanies = await db
        .select()
        .from(customerCompany)
        .where(eq(customerCompany.customerId, dup.id));

      const keepCompanies = await db
        .select()
        .from(customerCompany)
        .where(eq(customerCompany.customerId, keep.id));

      const keepNames = new Set(keepCompanies.map(c => c.organizationName));

      const toMove = dupCompanies.filter(c => !keepNames.has(c.organizationName));
      if (toMove.length > 0) {
        await db.insert(customerCompany).values(
          toMove.map(c => ({ ...c, id: nanoid(), customerId: keep.id, isPrimary: false }))
        );
        console.log(`  ✓ moved ${toMove.length} hospital affiliation(s) to keep record`);
      }

      // 3. Delete dup's companies then dup itself
      await db.delete(customerCompany).where(eq(customerCompany.customerId, dup.id));
      await db.delete(customer).where(eq(customer.id, dup.id));
      console.log(`  ✓ deleted duplicate customer ${dup.id}`);
    }
  }

  console.log("\n✓ Done");
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
