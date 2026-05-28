/**
 * Wipe all invoice + caseCommission rows for both orgs before reseeding.
 * Run: npx dotenv-cli -e .env -- npx tsx scripts/clear-invoices.ts
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { invoice, caseCommission } from "../db/schema";
import { inArray } from "drizzle-orm";
import { ALL_ORG_IDS } from "./seed-config";

async function clear() {
  const db = drizzle({ client: neon(process.env.DATABASE_URL!) });

  const allInvoices = await db
    .select({ id: invoice.id })
    .from(invoice)
    .where(inArray(invoice.organizationId, [...ALL_ORG_IDS]));

  const ids = allInvoices.map((i) => i.id);
  console.log(`Invoices to delete: ${ids.length}`);

  const BATCH = 50;
  if (ids.length > 0) {
    for (let i = 0; i < ids.length; i += BATCH) {
      await db
        .delete(caseCommission)
        .where(inArray(caseCommission.invoiceId, ids.slice(i, i + BATCH)));
    }
    for (let i = 0; i < ids.length; i += BATCH) {
      await db
        .delete(invoice)
        .where(inArray(invoice.id, ids.slice(i, i + BATCH)));
    }
  }

  console.log("✓ All invoices and commissions cleared");
  process.exit(0);
}

clear().catch((err) => {
  console.error(err);
  process.exit(1);
});
