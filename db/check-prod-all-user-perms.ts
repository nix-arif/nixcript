import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

function readUrl(file: string) {
  const m = readFileSync(file, "utf-8").match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error(`No DATABASE_URL in ${file}`);
  return m[1].trim().replace(/^["']|["']$/g, "");
}

async function run() {
  const sql = neon(readUrl(".env")); // prod

  // All user_permission rows grouped by user
  const rows = await sql`
    SELECT up.permission_key, up.allowed, up.organization_id,
           u.email, m.role
    FROM user_permission up
    JOIN "user" u ON u.id = up.user_id
    JOIN member m ON m.user_id = up.user_id AND m.organization_id = up.organization_id
    WHERE u.email != 'nix.arif@gmail.com'
    ORDER BY u.email, up.permission_key
  `;

  if (rows.length === 0) {
    console.log("No user_permission rows for non-owner users.");
  } else {
    let lastEmail = "";
    for (const r of rows) {
      if (r.email !== lastEmail) {
        console.log(`\n${r.email} (${r.role}) — org: ${r.organization_id}`);
        lastEmail = r.email as string;
      }
      console.log(`  ${String(r.allowed ? "✓" : "✗")} ${r.permission_key}`);
    }
  }
}

run().catch(console.error);
