import { neon } from "@neondatabase/serverless";
import { ORG } from "./seed-config";
const sql = neon(process.env.DATABASE_URL!);
async function main() {
  const rows = await sql`
    SELECT organization_id, COUNT(*) as cnt
    FROM invoice
    WHERE organization_id IN (${ORG.affirma}, ${ORG.innosys})
    GROUP BY organization_id
  `;
  rows.forEach(r => console.log(
    r.organization_id === ORG.affirma ? "Affirma" : "Innosys",
    r.cnt
  ));
  const samples = await sql`
    SELECT invoice_no FROM invoice
    WHERE organization_id = ${ORG.innosys}
    ORDER BY invoice_no LIMIT 10
  `;
  console.log("\nInnosys invoice_no samples:", samples.map(r => r.invoice_no));
}
main().catch(console.error);
