import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE '%customer%'
    ORDER BY table_name
  `;
  console.log('Tables:', tables.map((r: any) => r.table_name).join(', '));

  const cols = await sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('customer_company', 'customer_organization', 'customer_organization_member')
    ORDER BY table_name, ordinal_position
  `;
  for (const r of cols as any[]) console.log(`  ${r.table_name}.${r.column_name}`);
}
main().catch(console.error);
