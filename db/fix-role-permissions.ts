import { readFileSync } from "fs";
import { neon } from "@neondatabase/serverless";
import { ROLE_PERMISSIONS } from "../lib/permissions/constants";

function readUrl(file: string) {
  const m = readFileSync(file, "utf-8").match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error(`No DATABASE_URL in ${file}`);
  return m[1].trim().replace(/^["']|["']$/g, "");
}

async function fix(label: string, url: string) {
  const sql = neon(url);
  console.log(`\n=== ${label} ===`);

  // Show current state
  const roles = await sql`SELECT id, organization_id, role, permission FROM organization_role ORDER BY role`;
  console.log(`Found ${roles.length} role rows`);

  for (const row of roles) {
    const current: string[] = JSON.parse(row.permission as string);
    const dupes = current.filter((k, i) => current.indexOf(k) !== i);

    if (dupes.length === 0) {
      console.log(`  ${row.role} (org: ${row.organization_id}): OK`);
      continue;
    }

    // Deduplicate while preserving order
    const deduped = [...new Set(current)];
    console.log(`  ${row.role} (org: ${row.organization_id}): ${current.length} → ${deduped.length} keys (removed ${dupes.length} dupes: ${[...new Set(dupes)].join(", ")})`);

    const id = row.id as string;
    const permJson = JSON.stringify(deduped);
    await sql`UPDATE organization_role SET permission = ${permJson} WHERE id = ${id}`;
  }
}

async function run() {
  await fix("DEV", readUrl(".env.local"));
  await fix("PROD", readUrl(".env"));
  console.log("\nDone.");
}

run().catch(console.error);
