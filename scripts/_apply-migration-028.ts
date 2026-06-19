import { neon } from '@neondatabase/serverless';

async function main() {
  const dbName = process.env.DB_NAME ?? 'DB';
  const sql = neon(process.env.DATABASE_URL!);

  console.log(`Applying migration to ${dbName}...`);

  await sql`ALTER TABLE "customer_company" ADD COLUMN IF NOT EXISTS "customer_organization_id" text REFERENCES "customer_organization"("id") ON DELETE SET NULL`;
  console.log('  ✓ Added customer_organization_id FK (if not exists)');

  await sql`ALTER TABLE "customer_company" DROP COLUMN IF EXISTS "organization_name"`;
  console.log('  ✓ Dropped organization_name (if exists)');

  await sql`ALTER TABLE "customer_company" DROP COLUMN IF EXISTS "organization_address"`;
  console.log('  ✓ Dropped organization_address (if exists)');

  await sql`DROP TABLE IF EXISTS "customer_organization_member" CASCADE`;
  console.log('  ✓ Dropped customer_organization_member (if exists)');

  // Verify final state
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customer_company'
    ORDER BY ordinal_position
  `;
  console.log('  customer_company columns:', cols.map((r: any) => r.column_name).join(', '));

  const com = await sql`
    SELECT count(*) AS cnt FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'customer_organization_member'
  `;
  console.log('  customer_organization_member table exists:', (com[0] as any).cnt === '1' ? 'YES (unexpected)' : 'NO (good)');
}
main().catch(console.error);
