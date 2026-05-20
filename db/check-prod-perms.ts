import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

function readUrl(file: string) {
  const m = readFileSync(file, "utf-8").match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error(`No DATABASE_URL in ${file}`);
  return m[1].trim().replace(/^["']|["']$/g, "");
}

async function check(label: string, url: string) {
  const sql = neon(url);
  console.log(`\n=== ${label} (${url.slice(0, 55)}) ===`);

  // 1. permission table
  const perms = await sql`SELECT key, label FROM permission ORDER BY key`;
  const permKeys = perms.map((p: any) => p.key);
  const dupPermKeys = permKeys.filter((k: string, i: number) => permKeys.indexOf(k) !== i);
  console.log(`permission table: ${perms.length} rows, duplicates: ${dupPermKeys.length ? dupPermKeys : "none"}`);

  // 2. user_permission: actual duplicate rows per user+org+key
  const dupUserPerms = await sql`
    SELECT user_id, organization_id, permission_key, COUNT(*) as cnt
    FROM user_permission
    GROUP BY user_id, organization_id, permission_key
    HAVING COUNT(*) > 1
  `;
  console.log(`user_permission duplicate rows: ${dupUserPerms.length || "none"}`);
  if (dupUserPerms.length) dupUserPerms.forEach((r: any) => console.log(`  user=${r.user_id} org=${r.organization_id} key=${r.permission_key} cnt=${r.cnt}`));

  // 3. organization_role: show all role permission JSON arrays, highlight dupes
  const roles = await sql`SELECT id, organization_id, role, permission FROM organization_role ORDER BY role, organization_id`;
  console.log(`organization_role: ${roles.length} rows`);
  for (const row of roles) {
    const arr: string[] = JSON.parse(row.permission as string);
    const dupes = arr.filter((k, i) => arr.indexOf(k) !== i);
    const uniqueDupes = [...new Set(dupes)];
    if (uniqueDupes.length) {
      console.log(`  [DUPE] role=${row.role} org=${row.organization_id}: ${arr.length} keys, dupes: ${uniqueDupes.join(", ")}`);
    } else {
      console.log(`  [OK]   role=${row.role} org=${row.organization_id}: ${arr.length} keys`);
    }
  }
}

async function run() {
  await check("DEV (.env.local)", readUrl(".env.local"));
  await check("PROD (.env)", readUrl(".env"));
}

run().catch(console.error);
