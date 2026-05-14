import "dotenv/config";
import { db } from "@/db";
import { organization, permission } from "@/db/schema";
import { defaultPermissions } from "@/db/seeds/permissions";
import { nanoid } from "nanoid";
import { seedOrganizationRoles } from "./seeds/organization-roles";

async function seed() {
  console.log("Seeding permissions...");

  for (const perm of defaultPermissions) {
    await db
      .insert(permission)
      .values({ id: nanoid(), key: perm.key, label: perm.label })
      .onConflictDoNothing(); // safe to re-run
  }

  console.log("Done.");
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
