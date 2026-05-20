import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { readFileSync } from "fs";
import { and, eq } from "drizzle-orm";
import { member, userPermission } from "../db/schema";

function readUrl(file: string) {
  const m = readFileSync(file, "utf-8").match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error(`No DATABASE_URL in ${file}`);
  return m[1].trim().replace(/^["']|["']$/g, "");
}

async function run() {
  const sql = neon(readUrl(".env"));
  const db = drizzle({ client: sql });

  const userId = "FXEH0SyXM4YOrNIkp1wk28tiW47AuOTc"; // smartinnosys
  const orgId = "g63wYhdti8elZdv8yfaU00YQ2xYpP8DU"; // Smart Innosys

  // 1. Check member row (same as getUserPermissions step 1)
  const [memberData] = await db
    .select()
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
    .limit(1);
  console.log("memberData:", memberData ? `role=${memberData.role}` : "NOT FOUND");

  if (!memberData) {
    console.error("BUG: member row not found — getUserPermissions returns []");
    return;
  }

  // 2. Check userPermission with allowed=true (same as getUserPermissions step 2)
  const rows = await db
    .select()
    .from(userPermission)
    .where(
      and(
        eq(userPermission.userId, userId),
        eq(userPermission.organizationId, orgId),
        eq(userPermission.allowed, true),
      ),
    );
  console.log(`userPermission rows (allowed=true): ${rows.length}`);

  const keys = rows.map((r) => r.permissionKey);
  console.log("Has quotation:create:", keys.includes("quotation:create"));
  console.log("Has customer:read:", keys.includes("customer:read"));

  // 3. Check ALL userPermission rows (no allowed filter)
  const allRows = await db
    .select()
    .from(userPermission)
    .where(
      and(
        eq(userPermission.userId, userId),
        eq(userPermission.organizationId, orgId),
      ),
    );
  console.log(`\nAll userPermission rows (no filter): ${allRows.length}`);
  const allowed = allRows.filter((r) => r.allowed);
  const disallowed = allRows.filter((r) => !r.allowed);
  console.log(`  allowed=true: ${allowed.length}`);
  console.log(`  allowed=false/null: ${disallowed.length}`);
  if (disallowed.length > 0) {
    console.log("  Disallowed keys:", disallowed.map((r) => r.permissionKey));
  }

  // 4. Log the raw 'allowed' value type
  if (allRows.length > 0) {
    const sample = allRows[0];
    console.log(`\nSample row allowed value: ${JSON.stringify(sample.allowed)} (type: ${typeof sample.allowed})`);
  }
}

run().catch(console.error);
