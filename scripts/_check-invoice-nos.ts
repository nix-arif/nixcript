import { neon } from '@neondatabase/serverless';
import { ALL_ORG_IDS } from "./seed-config";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT organization_id, invoice_no
    FROM invoice
    WHERE organization_id = ANY(${[...ALL_ORG_IDS] as string[]}::text[])
    GROUP BY organization_id, invoice_no
    ORDER BY organization_id, invoice_no
    LIMIT 5
  `;
  for (const r of rows as any[]) console.log(`[${r.organization_id.slice(0,8)}] ${r.invoice_no}`);
  
  // Check distinct prefixes
  const prefixes = await sql`
    SELECT DISTINCT regexp_replace(invoice_no, '[0-9/\-]', '', 'g') as prefix, organization_id
    FROM invoice
    WHERE organization_id = ANY(${[...ALL_ORG_IDS] as string[]}::text[])
  `;
  console.log('\nPrefixes:', prefixes);
}
main().catch(console.error);
