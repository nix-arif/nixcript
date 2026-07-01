import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env") });

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  await sql`
    ALTER TABLE sales_order_item
    ALTER COLUMN description_source TYPE json USING description_source::json
  `;
  console.log("description_source column type changed to json");
}

main().catch(console.error);
