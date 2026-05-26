import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { customer, customerCompany } from "../db/schema";
import { inArray } from "drizzle-orm";
import { ALL_ORG_IDS } from "./seed-config";

async function main() {
  const db = drizzle({ client: neon(process.env.DATABASE_URL!) });

  // Get all customer IDs in our orgs
  const customers = await db
    .select({ id: customer.id })
    .from(customer)
    .where(inArray(customer.organizationId, [...ALL_ORG_IDS]));

  const ids = customers.map(c => c.id);
  console.log(`Found ${ids.length} customers to wipe`);

  if (ids.length === 0) { console.log("Nothing to do."); process.exit(0); }

  // Wipe customerCompany first (FK)
  const BATCH = 50;
  for (let i = 0; i < ids.length; i += BATCH) {
    await db.delete(customerCompany)
      .where(inArray(customerCompany.customerId, ids.slice(i, i + BATCH)));
  }

  // Then wipe customers
  for (let i = 0; i < ids.length; i += BATCH) {
    await db.delete(customer)
      .where(inArray(customer.id, ids.slice(i, i + BATCH)));
  }

  console.log("✓ Wiped all customers and affiliations");
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
