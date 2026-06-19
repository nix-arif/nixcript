import { neon } from '@neondatabase/serverless';
import { ORG } from "./seed-config";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  
  const cfg = await sql`
    SELECT * FROM document_numbering_setting WHERE document_type = 'do' LIMIT 5
  `;
  console.log('DO numbering config:', JSON.stringify(cfg, null, 2));
  
  const ctr = await sql`SELECT * FROM delivery_order_counter`;
  console.log('DO counters:', ctr);
  
  // Count invoices per org to understand seeding scope
  const counts = await sql`
    SELECT organization_id, count(*) as cnt, 
           min(invoice_date) as earliest, max(invoice_date) as latest
    FROM invoice
    WHERE organization_id = ANY(${[ORG.affirma, ORG.innosys] as string[]}::text[])
    GROUP BY organization_id
  `;
  console.log('Invoice counts:', counts);
  
  // Check existing DOs
  const dos = await sql`SELECT count(*) as cnt FROM delivery_order`;
  console.log('Existing DOs:', dos[0]);
}
main().catch(console.error);
