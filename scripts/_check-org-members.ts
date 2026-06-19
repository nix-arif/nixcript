import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  // Check customer_company rows with null customerOrganizationId
  const nullFk = await sql`
    SELECT id, customer_id FROM customer_company WHERE customer_organization_id IS NULL
  `;
  console.log('customer_company rows with NULL org FK:', nullFk.length);
  if (nullFk.length > 0) for (const r of nullFk as any[]) console.log(' ', r.id, r.customer_id);

  // Show all orgs and their member counts
  const orgs = await sql`
    SELECT co.id, co.name, co.organization_id,
           count(cc.id) AS members
    FROM customer_organization co
    LEFT JOIN customer_company cc ON cc.customer_organization_id = co.id
    GROUP BY co.id, co.name, co.organization_id
    ORDER BY co.name
  `;
  console.log('\nAll orgs and member counts:');
  for (const r of orgs as any[]) console.log(` [${r.organization_id.slice(0,8)}] "${r.name}" → ${r.members} members`);
}
main().catch(console.error);
