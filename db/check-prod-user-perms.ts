import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

function readUrl(file: string) {
  const m = readFileSync(file, "utf-8").match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error(`No DATABASE_URL in ${file}`);
  return m[1].trim().replace(/^["']|["']$/g, "");
}

async function run() {
  const sql = neon(readUrl(".env"));  // prod

  // 1. All quotation rows in user_permission
  const rows = await sql`
    SELECT up.user_id, up.organization_id, up.permission_key, up.allowed,
           u.name, u.email
    FROM user_permission up
    JOIN "user" u ON u.id = up.user_id
    WHERE up.permission_key LIKE 'quotation%'
    ORDER BY u.email, up.permission_key
  `;
  console.log("=== user_permission rows for quotation:* ===");
  for (const r of rows) {
    console.log(`  ${r.email} | ${r.permission_key} | allowed=${r.allowed} | org=${r.organization_id}`);
  }

  // 2. Check unique index exists
  const idx = await sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'user_permission' AND indexname = 'user_permission_unique'
  `;
  console.log("\n=== Unique index on user_permission ===");
  console.log(idx.length ? idx[0] : "MISSING — unique index does not exist!");

  // 3. Members in prod orgs
  const members = await sql`
    SELECT m.user_id, m.organization_id, m.role, u.email
    FROM member m
    JOIN "user" u ON u.id = m.user_id
    ORDER BY m.organization_id, u.email
  `;
  console.log("\n=== Members ===");
  for (const m of members) {
    console.log(`  ${m.email} | role=${m.role} | org=${m.organization_id}`);
  }
}

run().catch(console.error);
