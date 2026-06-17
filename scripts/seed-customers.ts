/**
 * Step 1 — Seed customers (surgeons) + their hospital affiliations
 *
 * customer table:
 *   - name     = normalized surgeon name (without title)
 *   - title    = Dr / Mr / Ms / etc.
 *   - organizationId = org with the MOST invoice rows for this surgeon
 *                      (cross-org surgeons → one record, one canonical org)
 *   - contactNo = first non-empty CONTACT NO found
 *
 * customerCompany table (one row per hospital per surgeon, across ALL orgs):
 *   - isPrimary = true  for the hospital with the most invoices
 *   - isPrimary = false for all secondary hospitals
 *
 * Deduplication key: name only (NOT orgId|name)
 *   → A surgeon appearing in both Affirma AND Innosys rows becomes ONE customer.
 *
 * Idempotent:
 *   - Skips customer insert if already exists (name match, org-agnostic)
 *   - Deletes + re-inserts customerCompany rows to stay in sync
 *
 * Run:
 *   npx dotenv-cli -e .env -- npx tsx scripts/seed-customers.ts
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
// Key: normalized surgeon NAME only (cross-org surgeons → one entry)

type HospitalEntry = { name: string; count: number };

type CustomerEntry = {
  /** orgId → row count — we pick the org with the highest count as the canonical org */
  orgCounts: Map<string, number>;
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
  const hospital         = normalizeHospital(hospitalRaw);

  // Key by name only — cross-org surgeons merge into one entry
  if (!customerMap.has(name)) {
    customerMap.set(name, {
      orgCounts: new Map(),
      title,
      name,
      hospitals: new Map(),
      contactNo: null,
    });
  }

  const entry = customerMap.get(name)!;

  // Track per-org row count (to pick canonical org later)
  entry.orgCounts.set(orgId, (entry.orgCounts.get(orgId) ?? 0) + 1);

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Pick the org with the most rows; fall back to Affirma if tied */
function primaryOrgId(entry: CustomerEntry): string {
  let max = 0;
  let best: string = ORG.affirma;
  for (const [orgId, count] of entry.orgCounts) {
    if (count > max) { max = count; best = orgId; }
  }
  return best;
}

function primaryHospital(entry: CustomerEntry): string {
  let max = 0;
  let primary = "";
  for (const h of entry.hospitals.values()) {
    if (h.count > max) { max = h.count; primary = h.name; }
  }
  return primary;
}

// ─── Stats ───────────────────────────────────────────────────────────────────

const affirmaOnly = [...customerMap.values()].filter(c => c.orgCounts.size === 1 && c.orgCounts.has(ORG.affirma));
const innosysOnly = [...customerMap.values()].filter(c => c.orgCounts.size === 1 && c.orgCounts.has(ORG.innosys));
const crossOrg    = [...customerMap.values()].filter(c => c.orgCounts.size > 1);

console.log(`Customers to seed: ${customerMap.size}`);
console.log(`  Affirma only  : ${affirmaOnly.length}`);
console.log(`  Innosys only  : ${innosysOnly.length}`);
console.log(`  Cross-org     : ${crossOrg.length}`);
crossOrg.forEach(c => {
  const orgs = [...c.orgCounts.entries()].map(([id, n]) =>
    `${id === ORG.affirma ? "Affirma" : "Innosys"}(${n})`
  ).join(" + ");
  console.log(`    "${c.name}" — ${orgs} → canonical: ${primaryOrgId(c) === ORG.affirma ? "Affirma" : "Innosys"}`);
});

const multiHospital = [...customerMap.values()].filter(c => c.hospitals.size > 1);
console.log(`\nMulti-hospital surgeons: ${multiHospital.length}`);
multiHospital.forEach(c => {
  const hosp = [...c.hospitals.values()].sort((a, b) => b.count - a.count);
  console.log(`  ${c.name}: ${hosp.map(h => `${h.name}(${h.count})`).join(", ")}`);
});

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function seed() {
  const db = drizzle({ client: neon(process.env.DATABASE_URL!) });

  // ── Step 1: fetch existing customers across all our orgs ──────────────────
  const existing = await db
    .select({ id: customer.id, name: customer.name })
    .from(customer)
    .where(inArray(customer.organizationId, [...ALL_ORG_IDS]));

  // name → customerId  (name-only key now)
  const existingMap = new Map(existing.map(c => [c.name, c.id]));
  console.log(`\nExisting customers: ${existing.length}`);

  // ── Step 2: insert missing customers ────────────────────────────────────
  const toInsert = [...customerMap.values()].filter(
    c => !existingMap.has(c.name)
  );

  if (toInsert.length > 0) {
    console.log(`Inserting ${toInsert.length} new customers…`);

    const newRows = toInsert.map(c => ({
      id:               nanoid(),
      organizationId:   primaryOrgId(c),
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

    for (const r of newRows) {
      existingMap.set(r.name, r.id);
    }
    console.log(`  ✓ inserted ${toInsert.length}`);
  } else {
    console.log("All customers already exist.");
  }

  // ── Step 3: collect all customer IDs we manage ────────────────────────────
  const ourCustomerIds = [...customerMap.values()]
    .map(c => existingMap.get(c.name))
    .filter((id): id is string => !!id);

  // ── Step 4: wipe + re-insert customerCompany rows (idempotent) ────────────
  console.log(`\nRebuilding hospital affiliations for ${ourCustomerIds.length} customers…`);

  const BATCH = 50;
  for (let i = 0; i < ourCustomerIds.length; i += BATCH) {
    await db
      .delete(customerCompany)
      .where(inArray(customerCompany.customerId, ourCustomerIds.slice(i, i + BATCH)));
  }

  const companyRows: {
    id: string;
    customerId: string;
    organizationName: string;
    isPrimary: boolean;
  }[] = [];

  for (const entry of customerMap.values()) {
    const customerId = existingMap.get(entry.name);
    if (!customerId) continue;

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

  for (let i = 0; i < companyRows.length; i += BATCH) {
    await db.insert(customerCompany).values(companyRows.slice(i, i + BATCH));
  }

  console.log(`  ✓ inserted ${companyRows.length} hospital affiliation rows`);

  // ── Summary ────────────────────────────────────────────────────────────────
  const totalCustomers = await db
    .select({ id: customer.id })
    .from(customer)
    .where(inArray(customer.organizationId, [...ALL_ORG_IDS]));

  console.log(`\n✓ Customers   : ${totalCustomers.length}`);
  console.log(`✓ Affiliations: ${companyRows.length}  (${companyRows.length - ourCustomerIds.length} secondary hospitals)`);
  console.log("\nDone!");
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
