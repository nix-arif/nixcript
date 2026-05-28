import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { documentNumberingSetting } from "../db/schema";

async function check() {
  const db = drizzle({ client: neon(process.env.DATABASE_URL!) });
  const rows = await db.select().from(documentNumberingSetting);
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}
check().catch(e => { console.error(e); process.exit(1); });
