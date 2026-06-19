import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  // Check if any customer_organization_member rows have data NOT in customer_company
  const orphans = await sql`
    SELECT com.id, com.customer_id, com.customer_organization_id
    FROM customer_organization_member com
    WHERE NOT EXISTS (
      SELECT 1 FROM customer_company cc
      WHERE cc.customer_id = com.customer_id
        AND cc.customer_organization_id = com.customer_organization_id
    )
  `;
  console.log('com rows NOT in customer_company:', orphans.length);
  if (orphans.length > 0) console.log(JSON.stringify(orphans, null, 2));

  // Check customer_company rows with no customerOrganizationId (would lose hospital link)
  const noFk = await sql`
    SELECT id, customer_id, organization_name FROM customer_company
    WHERE customer_organization_id IS NULL AND organization_name IS NOT NULL
  `;
  console.log('customer_company rows with no FK but have org name:', noFk.length);
  if (noFk.length > 0) console.log(JSON.stringify(noFk, null, 2));

  // Check old flat columns still have data
  const withOldCols = await sql`
    SELECT count(*) as n FROM customer_company
    WHERE organization_name IS NOT NULL OR organization_address IS NOT NULL
  `;
  console.log('customer_company rows with old flat cols:', withOldCols[0].n);
}
main().catch(console.error);
