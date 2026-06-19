import { neon } from '@neondatabase/serverless';
import { ALL_ORG_IDS } from "./seed-config";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  
  // Verify DO no matches invoice no (INV→DO)
  const mismatches = await sql`
    SELECT i.invoice_no, d.do_no
    FROM invoice i
    JOIN delivery_order d ON d.id = i.delivery_order_id
    WHERE i.organization_id = ANY(${[...ALL_ORG_IDS] as string[]}::text[])
      AND d.do_no != replace(i.invoice_no, 'INV', 'DO')
    LIMIT 5
  `;
  console.log('Mismatches:', mismatches.length === 0 ? 'none ✓' : JSON.stringify(mismatches));

  // Sample
  const sample = await sql`
    SELECT i.invoice_no, d.do_no, d.status
    FROM invoice i
    JOIN delivery_order d ON d.id = i.delivery_order_id
    WHERE i.organization_id = '9x4niIyrZTW3Vn78R54NbVkYvY0HXN0Z'
    ORDER BY i.invoice_no
    LIMIT 5
  `;
  console.log('Sample pairs:');
  for (const r of sample as any[]) console.log(`  ${r.invoice_no} → ${r.do_no} [${r.status}]`);
}
main().catch(console.error);
