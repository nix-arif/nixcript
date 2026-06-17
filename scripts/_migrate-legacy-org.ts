/**
 * One-time migration: create customerCompany rows for customers that have
 * legacy customer.organization_name set but no customerCompany rows yet.
 *
 * Run against prod:
 *   npx dotenv-cli -e .env -- npx tsx scripts/_migrate-legacy-org.ts
 */
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { customerCompany } from '../db/schema';
import { nanoid } from 'nanoid';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  const rows = await sql`
    SELECT c.id, c.name, c.organization_name, c.organization_address, c.position, c.department
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
    await db.insert(customerCompany).values({
      id: nanoid(),
      customerId: r.id,
      organizationName: r.organization_name ?? null,
      organizationAddress: r.organization_address || null,
      position: r.position || null,
      department: r.department || null,
      isPrimary: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log(`  ✓ ${r.name} → "${r.organization_name}"`);
  }

  console.log('Done.');
}
main().catch(console.error);
