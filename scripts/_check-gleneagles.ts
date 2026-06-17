import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT c.name, cc.organization_name, cc.is_primary, cc.position, cc.department
    FROM customer c
    JOIN customer_company cc ON cc.customer_id = c.id
    WHERE c.name IN ('Syed Alwi Bin Syed Abd Kadir', 'Laila')
    ORDER BY c.name
  `;
  console.log(JSON.stringify(rows, null, 2));
}
main();
