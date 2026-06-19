import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  // For each duplicate, show which customers are linked to each copy
  const links = await sql`
    SELECT co.id, co.name, co.organization_id AS tenant_id,
           count(cc.id) AS linked_customers,
           array_agg(c.name ORDER BY c.name) AS customer_names
    FROM customer_organization co
    LEFT JOIN customer_company cc ON cc.customer_organization_id = co.id
    LEFT JOIN customer c ON c.id = cc.customer_id
    WHERE co.id IN ('JyiNVUHUn9EnCFqsZMZ71', 'co_82be441a-e6f7-419c-b36e-c9ceaeab564a')
    GROUP BY co.id, co.name, co.organization_id
  `;
  for (const r of links as any[]) {
    console.log(`ID: ${r.id}`);
    console.log(`  tenant: ${r.tenant_id}`);
    console.log(`  linked customers (${r.linked_customers}): ${r.customer_names}`);
  }
}
main().catch(console.error);
