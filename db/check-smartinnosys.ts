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

  const users = await sql`SELECT id, email, name FROM "user" ORDER BY email`;
  console.log("Users:", users.map((u: any) => u.email).join(", "));

  const smart = users.find((u: any) => u.email === "smartinnosys@gmail.com");
  if (!smart) { console.log("smartinnosys NOT in this DB"); return; }

  const perms = await sql`
    SELECT up.permission_key, up.allowed
    FROM user_permission up
    WHERE up.user_id = ${smart.id} AND up.allowed = true
    ORDER BY up.permission_key
  `;
  console.log(`smartinnosys permissions (${perms.length}):`);
  perms.forEach((p: any) => console.log(`  ✓ ${p.permission_key}`));
}

async function run() {
  await check("env.local", readUrl(".env.local"));
  await check("env (prod)", readUrl(".env"));
}

run().catch(console.error);
