import { neon } from "@neondatabase/serverless";
import { ALL_ORG_IDS, ORG } from "./seed-config";

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  // Find surgeons with the same name across DIFFERENT orgs (cross-org duplicates)
  const crossOrg = await sql`
    SELECT name, COUNT(DISTINCT organization_id) as org_count, 
           array_agg(DISTINCT organization_id) as org_ids,
           array_agg(id) as customer_ids
    FROM customer
    WHERE organization_id = ANY(${ALL_ORG_IDS as unknown as string[]})
    GROUP BY name
    HAVING COUNT(DISTINCT organization_id) > 1
    ORDER BY name
  `;

  console.log(`Cross-org duplicate surgeons: ${crossOrg.length}`);
  crossOrg.forEach(r => {
    const orgs = (r.org_ids as string[]).map(id => 
      id === ORG.affirma ? "Affirma" : id === ORG.innosys ? "Innosys" : id
    );
    console.log(`  "${r.name}" — ${orgs.join(" + ")} (ids: ${(r.customer_ids as string[]).join(", ")})`);
  });

  // Also show multi-hospital within same org (legit multi-hospital)
  const multiHosp = await sql`
    SELECT c.name, c.organization_id, COUNT(cc.id) as hospital_count,
           array_agg(cc.organization_name ORDER BY cc.is_primary DESC) as hospitals
    FROM customer c
    JOIN customer_company cc ON cc.customer_id = c.id
    WHERE c.organization_id = ANY(${ALL_ORG_IDS as unknown as string[]})
    GROUP BY c.id, c.name, c.organization_id
    HAVING COUNT(cc.id) > 1
    ORDER BY c.name
  `;

  console.log(`\nLegit multi-hospital (same org, multiple hospitals): ${multiHosp.length}`);
  multiHosp.forEach(r => {
    const org = r.organization_id === ORG.affirma ? "Affirma" : "Innosys";
    console.log(`  [${org}] "${r.name}" — ${(r.hospitals as string[]).join(", ")}`);
  });
}

main().catch(console.error);
