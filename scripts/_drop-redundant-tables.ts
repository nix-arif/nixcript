import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  console.log('Dropping customer_organization_member table...');
  await sql`DROP TABLE IF EXISTS customer_organization_member CASCADE`;
  console.log('Done.');

  console.log('Dropping old flat columns from customer_company...');
  await sql`ALTER TABLE customer_company DROP COLUMN IF EXISTS organization_name`;
  await sql`ALTER TABLE customer_company DROP COLUMN IF EXISTS organization_address`;
  console.log('Done.');

  // Verify final state
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customer_company'
    ORDER BY ordinal_position
  `;
  console.log('customer_company columns:', cols.map((r: any) => r.column_name).join(', '));
}
main().catch(console.error);
