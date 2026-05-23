/**
 * One-time migration: move existing organizationName / organizationAddress /
 * position / department from the customer table into customer_company rows.
 *
 * Run once after deploying the schema change:
 *   npx tsx db/migrate-customer-companies.ts
 */

import "dotenv/config";
import { db } from ".";
import { customer, customerCompany } from "./schema";
import { isNotNull, or, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

async function main() {
  const rows = await db
    .select({
      id: customer.id,
      organizationName: customer.organizationName,
      organizationAddress: customer.organizationAddress,
      position: customer.position,
      department: customer.department,
    })
    .from(customer)
    .where(
      or(
        isNotNull(customer.organizationName),
        isNotNull(customer.position),
        isNotNull(customer.department),
      )!,
    );

  console.log(`Found ${rows.length} customers with legacy company data`);
  if (rows.length === 0) {
    console.log("Nothing to migrate.");
    return;
  }

  // Skip any that already have a company record
  const existingLinks = await db
    .select({ customerId: customerCompany.customerId })
    .from(customerCompany)
    .where(
      inArray(
        customerCompany.customerId,
        rows.map((r) => r.id),
      ),
    );
  const alreadyMigrated = new Set(existingLinks.map((e) => e.customerId));

  const toInsert = rows.filter((r) => !alreadyMigrated.has(r.id));
  console.log(`Inserting company records for ${toInsert.length} customers…`);

  if (toInsert.length > 0) {
    await db.insert(customerCompany).values(
      toInsert.map((r) => ({
        id: nanoid(),
        customerId: r.id,
        organizationName: r.organizationName,
        organizationAddress: r.organizationAddress,
        position: r.position,
        department: r.department,
        isPrimary: true,
      })),
    );
  }

  console.log(`Done — migrated ${toInsert.length} records.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
