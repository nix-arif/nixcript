import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  // Verify no duplicates remain
  const dupes = await sql`
    WITH owner_orgs AS (
      SELECT co.id, co.name, m.user_id AS owner_id
      FROM customer_organization co
      JOIN member m ON m.organization_id = co.organization_id AND m.role = 'owner'
    )
    SELECT owner_id, name, count(*) AS cnt
    FROM owner_orgs
    GROUP BY owner_id, name
    HAVING count(*) > 1
  `;
  console.log('Remaining duplicates:', dupes.length);

  // Show Prince Court links now
  const links = await sql`
    SELECT co.id, co.name, co.organization_id, count(cc.id) AS linked
    FROM customer_organization co
    LEFT JOIN customer_company cc ON cc.customer_organization_id = co.id
    WHERE co.name ILIKE '%prince court%'
    GROUP BY co.id, co.name, co.organization_id
  `;
  console.log('Prince Court entries:', links.length);
  for (const r of links as any[]) console.log(` ${r.id} tenant=${r.organization_id} links=${r.linked}`);

  // Total row counts
  const counts = await sql`
    SELECT
      (SELECT count(*) FROM customer_organization) AS orgs,
      (SELECT count(*) FROM customer_company) AS companies
  `;
  console.log('Counts:', counts[0]);
}
main().catch(console.error);
