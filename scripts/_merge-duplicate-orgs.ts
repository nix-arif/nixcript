import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  // Find all duplicate org names within the same owner's orgs
  const dupes = await sql`
    WITH owner_orgs AS (
      SELECT co.id AS org_id, co.name, co.organization_id AS tenant_id,
             co.address, co.phone, co.email, co.created_at,
             m.user_id AS owner_id
      FROM customer_organization co
      JOIN member m ON m.organization_id = co.organization_id AND m.role = 'owner'
    ),
    dupe_names AS (
      SELECT owner_id, name
      FROM owner_orgs
      GROUP BY owner_id, name
      HAVING count(*) > 1
    )
    SELECT oo.*
    FROM owner_orgs oo
    JOIN dupe_names d ON d.owner_id = oo.owner_id AND d.name = oo.name
    ORDER BY oo.name, oo.created_at
  `;

  // Group by (owner_id, name)
  const groups = new Map<string, any[]>();
  for (const r of dupes as any[]) {
    const key = `${r.owner_id}::${r.name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  console.log(`Found ${groups.size} duplicate group(s)`);

  for (const [key, rows] of groups) {
    const name = rows[0].name;
    // Keep the one with most customer_company links (or oldest if tie)
    const withCounts = await Promise.all(rows.map(async (r) => {
      const [{ cnt }] = await sql`
        SELECT count(*) AS cnt FROM customer_company WHERE customer_organization_id = ${r.org_id}
      `;
      return { ...r, linkCount: Number(cnt) };
    }));
    withCounts.sort((a, b) => b.linkCount - a.linkCount || a.created_at - b.created_at);
    const canonical = withCounts[0];
    const duplicates = withCounts.slice(1);

    console.log(`\n"${name}" — keeping ${canonical.org_id} (${canonical.tenant_id}, ${canonical.linkCount} links)`);

    for (const dup of duplicates) {
      console.log(`  Merging ${dup.org_id} (${dup.tenant_id}, ${dup.linkCount} links)`);

      // Move customer_company links — skip if canonical already has same customer
      const moved = await sql`
        UPDATE customer_company
        SET customer_organization_id = ${canonical.org_id}
        WHERE customer_organization_id = ${dup.org_id}
          AND customer_id NOT IN (
            SELECT customer_id FROM customer_company WHERE customer_organization_id = ${canonical.org_id}
          )
      `;
      console.log(`    Moved ${moved.count} customer_company rows`);

      // Delete any remaining links to dup (duplicates that canonical already covers)
      const deleted = await sql`
        DELETE FROM customer_company WHERE customer_organization_id = ${dup.org_id}
      `;
      console.log(`    Deleted ${deleted.count} duplicate links`);

      // Delete the duplicate org
      await sql`DELETE FROM customer_organization WHERE id = ${dup.org_id}`;
      console.log(`    Deleted org ${dup.org_id}`);
    }
  }

  console.log('\nDone.');
}
main().catch(console.error);
