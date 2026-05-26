/**
 * Step 1 — Seed customers (surgeons) + their hospital affiliations
 *
 * customer table:
 *   - name            = normalized surgeon name (without title)
 *   - title           = Dr / Mr / Ms / etc.
 *   - organizationName = PRIMARY hospital (highest invoice count)
 *   - contactNo       = first non-empty CONTACT NO found
 *
 * customerCompany table (one row per hospital per surgeon):
 *   - isPrimary = true  for the hospital with the most invoices
 *   - isPrimary = false for all secondary hospitals
 *
 * Idempotent:
 *   - Skips customer insert if already exists (orgId + name match)
 *   - Deletes + re-inserts customerCompany rows to stay in sync
 *
 * Run:
 *   DATABASE_URL="<prod_url>" npx tsx scripts/seed-customers.ts
 */

import * as XLSX from "xlsx";
import { nanoid } from "nanoid";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { customer, customerCompany } from "../db/schema";
import { inArray, eq } from "drizzle-orm";
import {
  ORG,
  ALL_ORG_IDS,
  CREATED_BY,
  XLSX_FILE,
  resolveOrgId,
  normalizeSurgeon,
  normalizeHospital,
  str,
} from "./seed-config";

// ─── Load Excel ───────────────────────────────────────────────────────────────

const wb   = XLSX.readFile(XLSX_FILE);
const ws   = wb.Sheets["Case Detail"];
const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, {
  defval: null,
  raw: false,
});

// ─── Build customer map ───────────────────────────────────────────────────────
// Key: "orgId|normalizedName"

type HospitalEntry = { name: string; count: number };

type CustomerEntry = {
  orgId:     string;
  title:     string | null;
  name:      string;
  hospitals: Map<string, HospitalEntry>; // hospital name → { name, count }
  contactNo: string | null;
};

const customerMap = new Map<string, CustomerEntry>();

for (const r of rows) {
  if (!str(r["INVOICE NO"])) continue;

  const surgeonRaw  = str(r["SURGEON"]);
  const hospitalRaw = str(r["HOSPITAL"]);
  const contactRaw  = str(r["CONTACT NO"]);
  const orgId       = resolveOrgId(r["COMPANY"]);

  if (!surgeonRaw || !hospitalRaw || !orgId) continue;

  const { title, name } = normalizeSurgeon(surgeonRaw);
  const hospital        = normalizeHospital(hospitalRaw);
  const key             = `${orgId}|${name}`;

  if (!customerMap.has(key)) {
    customerMap.set(key, {
      orgId,
      title,
      name,
      hospitals: new Map(),
      contactNo: null,
    });
  }

  const entry = customerMap.get(key)!;

  // Accumulate hospital counts
  const h = entry.hospitals.get(hospital);
  if (h) {
    h.count++;
  } else {
    entry.hospitals.set(hospital, { name: hospital, count: 1 });
  }

  // Keep first non-empty contact number
  if (!entry.contactNo && contactRaw) entry.contactNo = contactRaw;
}

// ─── Derive primary hospital (highest invoice count) ─────────────────────────

function primaryHospital(entry: CustomerEntry): string {
  let max = 0;
  let primary = "";
  for (const h of entry.hospitals.values()) {
    if (h.count > max) { max = h.count; primary = h.name; }
  }
  return primary;
}

console.log(`Customers to seed: ${customerMap.size}`);
console.log(`  Affirma : ${[...customerMap.values()].filter(c => c.orgId === ORG.affirma).length}`);
console.log(`  Innosys : ${[...customerMap.values()].filter(c => c.orgId === ORG.innosys).length}`);

const multiHospital = [...customerMap.values()].filter(c => c.hospitals.size > 1);
console.log(`  Multi-hospital surgeons: ${multiHospital.length}`);
multiHospital.forEach(c => {
  const hosp = [...c.hospitals.values()].sort((a,b) => b.count - a.count);
  console.log(`    ${c.name}: ${hosp.map(h => `${h.name}(${h.count})`).join(", ")}`);
});

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function seed() {
  const db = drizzle({ client: neon(process.env.DATABASE_URL!) });

  // ── Step 1: fetch existing customers ────────────────────────────────────────
  const existing = await db
    .select({ id: customer.id, organizationId: customer.organizationId, name: customer.name })
    .from(customer)
    .where(inArray(customer.organizationId, [...ALL_ORG_IDS]));

  // "orgId|name" → customerId
  const existingMap = new Map(existing.map(c => [`${c.organizationId}|${c.name}`, c.id]));
  console.log(`\nExisting customers: ${existing.length}`);

  // ── Step 2: insert missing customers ────────────────────────────────────────
  const toInsert = [...customerMap.values()].filter(
    c => !existingMap.has(`${c.orgId}|${c.name}`)
  );

  if (toInsert.length > 0) {
    console.log(`Inserting ${toInsert.length} new customers…`);

    const newRows = toInsert.map(c => ({
      id:               nanoid(),
      organizationId:   c.orgId,
      title:            c.title,
      name:             c.name,
      organizationName: primaryHospital(c),
      contactNo:        c.contactNo,
      createdBy:        CREATED_BY,
    }));

    const BATCH = 50;
    for (let i = 0; i < newRows.length; i += BATCH) {
      await db.insert(customer).values(newRows.slice(i, i + BATCH));
    }

    // Merge into lookup map
    for (const r of newRows) {
      existingMap.set(`${r.organizationId}|${r.name}`, r.id);
    }
    console.log(`  ✓ inserted ${toInsert.length}`);
  } else {
    console.log("All customers already exist.");
  }

  // ── Step 3: collect all customer IDs we own ──────────────────────────────────
  const ourCustomerIds = [...customerMap.values()]
    .map(c => existingMap.get(`${c.orgId}|${c.name}`))
    .filter((id): id is string => !!id);

  // ── Step 4: wipe + re-insert customerCompany rows (idempotent) ────────────────
  console.log(`\nRebuilding hospital affiliations for ${ourCustomerIds.length} customers…`);

  // Delete existing affiliations in batches
  const BATCH = 50;
  for (let i = 0; i < ourCustomerIds.length; i += BATCH) {
    await db
      .delete(customerCompany)
      .where(inArray(customerCompany.customerId, ourCustomerIds.slice(i, i + BATCH)));
  }

  // Build fresh customerCompany rows
  const companyRows: {
    id: string;
    customerId: string;
    organizationName: string;
    isPrimary: boolean;
  }[] = [];

  for (const entry of customerMap.values()) {
    const customerId = existingMap.get(`${entry.orgId}|${entry.name}`);
    if (!customerId) continue;

    // Sort hospitals by count desc — highest count = primary
    const sorted = [...entry.hospitals.values()].sort((a, b) => b.count - a.count);

    sorted.forEach((h, idx) => {
      companyRows.push({
        id:               nanoid(),
        customerId,
        organizationName: h.name,
        isPrimary:        idx === 0,
      });
    });
  }

  // Insert in batches
  for (let i = 0; i < companyRows.length; i += BATCH) {
    await db.insert(customerCompany).values(companyRows.slice(i, i + BATCH));
  }

  console.log(`  ✓ inserted ${companyRows.length} hospital affiliation rows`);

  // ── Summary ──────────────────────────────────────────────────────────────────
  const totalCustomers = await db
    .select({ id: customer.id })
    .from(customer)
    .where(inArray(customer.organizationId, [...ALL_ORG_IDS]));

  const totalAffiliations = await db
    .select({ id: customerCompany.id })
    .from(customerCompany)
    .where(inArray(
      customerCompany.customerId,
      ourCustomerIds,
    ));

  console.log(`\n✓ Customers   : ${totalCustomers.length}`);
  console.log(`✓ Affiliations: ${totalAffiliations.length}  (${totalAffiliations.length - ourCustomerIds.length} secondary hospitals)`);
  console.log("\nDone! Run seed-invoices.ts next.");
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
