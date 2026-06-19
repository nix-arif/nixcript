/**
 * One-time migration: create customerCompany rows for customers that have
 * legacy customer.organization_name set but no customerCompany rows yet.
 *
 * Run against prod:
 *   npx dotenv-cli -e .env -- npx tsx scripts/_migrate-legacy-org.ts
 */
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { customerCompany, customerOrganization } from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  const rows = await sql`
    SELECT c.id, c.name, c.organization_id, c.organization_name, c.organization_address, c.position, c.department
    FROM customer c
    WHERE c.organization_name IS NOT NULL
      AND c.organization_name <> ''
      AND NOT EXISTS (
        SELECT 1 FROM customer_company cc WHERE cc.customer_id = c.id
      )
  `;

  if (rows.length === 0) {
    console.log('Nothing to migrate.');
    return;
  }

  console.log(`Migrating ${rows.length} customer(s)...`);

  for (const r of rows) {
    // Find or create the customer_organization row for this tenant
    let [org] = await db
      .select({ id: customerOrganization.id })
      .from(customerOrganization)
      .where(and(
        eq(customerOrganization.organizationId, r.organization_id),
        eq(customerOrganization.name, r.organization_name),
      ))
      .limit(1);

    if (!org) {
      const [inserted] = await db
        .insert(customerOrganization)
        .values({
          id: `co_${nanoid()}`,
          organizationId: r.organization_id,
          name: r.organization_name,
          address: r.organization_address ?? null,
        })
        .returning({ id: customerOrganization.id });
      org = inserted;
    }

    await db.insert(customerCompany).values({
      id: nanoid(),
      customerId: r.id,
      customerOrganizationId: org.id,
      position: r.position || null,
      department: r.department || null,
      isPrimary: true,
      createdAt: new Date(),
    });
    console.log(`  ✓ ${r.name} → "${r.organization_name}"`);
  }

  console.log('Done.');
}
main().catch(console.error);
