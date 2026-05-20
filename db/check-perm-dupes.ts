import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

function readUrl(file: string) {
  const m = readFileSync(file, "utf-8").match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error(`No DATABASE_URL in ${file}`);
  return m[1].trim().replace(/^["']|["']$/g, "");
}

async function check(label: string, url: string) {
  const sql = neon(url);
  console.log(`\n=== ${label} ===`);

  const dupPerms = await sql`
    SELECT key, COUNT(*) as cnt FROM permission GROUP BY key HAVING COUNT(*) > 1
  `;
  console.log("Duplicate permission keys:", dupPerms.length ? dupPerms : "none");

  const dupUserPerms = await sql`
    SELECT user_id, organization_id, permission_key, COUNT(*) as cnt
    FROM user_permission
    GROUP BY user_id, organization_id, permission_key
    HAVING COUNT(*) > 1
  `;
  console.log("Duplicate user_permission rows:", dupUserPerms.length || "none");

  const quotPerms = await sql`
    SELECT permission_key, COUNT(*) as cnt FROM user_permission
    WHERE permission_key LIKE 'quotation%'
    GROUP BY permission_key ORDER BY permission_key
  `;
  console.log("Quotation entries per key in user_permission:", quotPerms.length ? quotPerms : "none");

  const allPerms = await sql`
    SELECT key FROM permission WHERE key LIKE 'quotation%' ORDER BY key
  `;
  console.log("Quotation keys in permission table:", allPerms.map((r: any) => r.key));
}

async function run() {
  await check("DEV", readUrl(".env.local"));
  await check("PROD", readUrl(".env"));
}

run().catch(console.error);
