import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { nanoid } from "nanoid";
import { ROLE_PERMISSIONS } from "../lib/permissions/constants";

function readUrl(file: string) {
  const m = readFileSync(file, "utf-8").match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error(`No DATABASE_URL in ${file}`);
  return m[1].trim().replace(/^["']|["']$/g, "");
}

async function run() {
  const sql = neon(readUrl(".env")); // prod

  const members = await sql`
    SELECT m.user_id, m.organization_id, m.role, u.email
    FROM member m
    JOIN "user" u ON u.id = m.user_id
    WHERE m.role != 'owner'
    ORDER BY u.email
  `;

  console.log("Applying full role permissions to non-owner members:\n");

  for (const m of members) {
    const rolePerms: readonly string[] = ROLE_PERMISSIONS[m.role as string] ?? [];
    if (rolePerms.length === 0) {
      console.log(`  [skip] ${m.email} — no ROLE_PERMISSIONS entry for role "${m.role}"`);
      continue;
    }

    console.log(`  ${m.email} (${m.role}) — ${rolePerms.length} permissions to ensure:`);

    for (const key of rolePerms) {
      const existing = await sql`
        SELECT allowed FROM user_permission
        WHERE user_id = ${m.user_id}
          AND organization_id = ${m.organization_id}
          AND permission_key = ${key}
      `;

      if (existing.length > 0 && existing[0].allowed === true) {
        process.stdout.write(".");
        continue;
      }

      const id = nanoid();
      await sql`
        INSERT INTO user_permission (id, user_id, organization_id, permission_key, allowed, created_at, updated_at)
        VALUES (${id}, ${m.user_id}, ${m.organization_id}, ${key}, true, NOW(), NOW())
        ON CONFLICT (user_id, organization_id, permission_key)
        DO UPDATE SET allowed = true, updated_at = NOW()
      `;
      process.stdout.write(`\n    [set] ${key}`);
    }
    console.log("\n");
  }

  console.log("Done. Summary:");
  const final = await sql`
    SELECT up.permission_key, up.allowed, u.email, m.role
    FROM user_permission up
    JOIN "user" u ON u.id = up.user_id
    JOIN member m ON m.user_id = up.user_id AND m.organization_id = up.organization_id
    WHERE m.role != 'owner' AND up.allowed = true
    ORDER BY u.email, up.permission_key
  `;
  let lastEmail = "";
  for (const r of final) {
    if (r.email !== lastEmail) {
      console.log(`\n  ${r.email} (${r.role}):`);
      lastEmail = r.email as string;
    }
    console.log(`    ✓ ${r.permission_key}`);
  }
}

run().catch(console.error);
