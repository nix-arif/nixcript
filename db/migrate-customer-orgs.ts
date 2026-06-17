/**
 * db/migrate-customer-orgs.ts
 *
 * Migrates existing customerCompany rows to the new many-to-many tables:
 *   customerOrganization  (shared org entity, deduped per tenant by name)
 *   customerOrganizationMember  (junction — one per old customerCompany row)
 *
 * Run with:
 *   npx tsx db/migrate-customer-orgs.ts
 *
 * The old customerCompany table is NOT dropped.
 */

import { db } from "@/db";
import { customer, customerCompany, customerOrganization, customerOrganizationMember } from "@/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

async function main() {
  console.log("Starting customerCompany → customerOrganization migration…");

  // 1. Fetch all existing customerCompany rows with their customer's organizationId (tenant)
  const rows = await db
    .select({
      id: customerCompany.id,
      customerId: customerCompany.customerId,
      organizationName: customerCompany.organizationName,
      organizationAddress: customerCompany.organizationAddress,
      position: customerCompany.position,
      department: customerCompany.department,
      isPrimary: customerCompany.isPrimary,
      createdAt: customerCompany.createdAt,
      // join to get the tenant org
      tenantOrgId: customer.organizationId,
    })
    .from(customerCompany)
    .innerJoin(customer, eq(customer.id, customerCompany.customerId));

  if (rows.length === 0) {
    console.log("No customerCompany rows found — nothing to migrate.");
    return;
  }

  console.log(`Found ${rows.length} customerCompany rows to migrate.`);

  // 2. Collect all unique (tenantOrgId, normalizedName) pairs
  //    Key: `${tenantOrgId}::${normalizedName}`
  type OrgKey = string;
  const orgMap = new Map<OrgKey, { id: string; name: string; address: string | null; tenantOrgId: string }>();

  for (const row of rows) {
    const name = row.organizationName?.trim() ?? "";
    if (!name) continue;
    const key: OrgKey = `${row.tenantOrgId}::${name.toLowerCase()}`;
    if (!orgMap.has(key)) {
      orgMap.set(key, {
        id: nanoid(),
        name,
        address: row.organizationAddress ?? null,
        tenantOrgId: row.tenantOrgId,
      });
    }
  }

  console.log(`Unique (tenant, orgName) pairs: ${orgMap.size}`);

  // 3. Check which orgs already exist in customerOrganization
  //    to avoid duplicates on re-run
  const existingOrgs = await db
    .select({ organizationId: customerOrganization.organizationId, name: customerOrganization.name, id: customerOrganization.id })
    .from(customerOrganization);

  const existingOrgLookup = new Map<OrgKey, string>(); // key → id
  for (const o of existingOrgs) {
    const key: OrgKey = `${o.organizationId}::${o.name.toLowerCase().trim()}`;
    existingOrgLookup.set(key, o.id);
  }

  // 4. Insert new customerOrganization rows
  let orgsInserted = 0;
  for (const [key, org] of orgMap) {
    if (existingOrgLookup.has(key)) {
      // Use existing id
      orgMap.set(key, { ...org, id: existingOrgLookup.get(key)! });
      continue;
    }
    await db.insert(customerOrganization).values({
      id: org.id,
      organizationId: org.tenantOrgId,
      name: org.name,
      address: org.address,
    });
    existingOrgLookup.set(key, org.id);
    orgsInserted++;
  }

  console.log(`Inserted ${orgsInserted} new customerOrganization rows.`);

  // 5. Check which memberships already exist (avoid duplicates on re-run)
  //    We match by customerId + customerOrganizationId
  const existingMemberIds = rows.length > 0
    ? await db
        .select({ customerId: customerOrganizationMember.customerId, customerOrganizationId: customerOrganizationMember.customerOrganizationId })
        .from(customerOrganizationMember)
    : [];

  const existingMemberSet = new Set<string>(
    existingMemberIds.map((m) => `${m.customerId}::${m.customerOrganizationId}`),
  );

  // 6. Insert customerOrganizationMember rows
  let membersInserted = 0;
  let membersSkipped = 0;

  for (const row of rows) {
    const name = row.organizationName?.trim() ?? "";
    if (!name) {
      membersSkipped++;
      continue;
    }
    const key: OrgKey = `${row.tenantOrgId}::${name.toLowerCase()}`;
    const customerOrgId = existingOrgLookup.get(key);
    if (!customerOrgId) {
      console.warn(`  Warning: no org found for key "${key}" — skipping row ${row.id}`);
      membersSkipped++;
      continue;
    }

    const memberKey = `${row.customerId}::${customerOrgId}`;
    if (existingMemberSet.has(memberKey)) {
      membersSkipped++;
      continue;
    }

    await db.insert(customerOrganizationMember).values({
      id: nanoid(),
      customerId: row.customerId,
      customerOrganizationId: customerOrgId,
      position: row.position,
      department: row.department,
      isPrimary: row.isPrimary,
      createdAt: row.createdAt,
    });
    existingMemberSet.add(memberKey);
    membersInserted++;
  }

  console.log(`Inserted ${membersInserted} customerOrganizationMember rows.`);
  console.log(`Skipped ${membersSkipped} rows (no org name or already existed).`);
  console.log("Migration complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
