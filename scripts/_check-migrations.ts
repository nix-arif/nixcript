import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`SELECT count(*) as cnt FROM drizzle.__drizzle_migrations`;
  console.log('Count:', rows[0]);
  
  // Get column names
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
    ORDER BY ordinal_position
  `;
  console.log('Columns:', cols.map((r: any) => r.column_name).join(', '));
}
main().catch(console.error);
