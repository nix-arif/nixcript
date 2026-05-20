import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { nanoid } from "nanoid";

function readUrl(file: string) {
  const m = readFileSync(file, "utf-8").match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error(`No DATABASE_URL in ${file}`);
  return m[1].trim().replace(/^["']|["']$/g, "");
}

async function run() {
  const sql = neon(readUrl(".env")); // prod

  // Fetch all non-owner members with their user IDs
  const members = await sql`
    SELECT m.user_id, m.organization_id, m.role, u.email
    FROM member m
    JOIN "user" u ON u.id = m.user_id
    WHERE m.role != 'owner'
    ORDER BY u.email
  `;

  console.log("Non-owner members:");
  members.forEach((m: any) =>
    console.log(`  ${m.email} | ${m.role} | org: ${m.organization_id}`)
  );

  // Permissions to grant per role
  const grantMap: Record<string, string[]> = {
    member: ["quotation:read", "quotation:create", "quotation:update"],
    admin:  ["quotation:read", "quotation:create", "quotation:update", "quotation:delete"],
    "finance manager": ["quotation:read"],
  };

  console.log("\nGranting missing quotation permissions...");

  for (const m of members) {
    const permsToGrant = grantMap[m.role as string];
    if (!permsToGrant) {
      console.log(`  [skip] unknown role: ${m.role} (${m.email})`);
      continue;
    }

    for (const key of permsToGrant) {
      // Check if row already exists with allowed=true
      const existing = await sql`
        SELECT allowed FROM user_permission
        WHERE user_id = ${m.user_id}
          AND organization_id = ${m.organization_id}
          AND permission_key = ${key}
      `;

      if (existing.length > 0 && existing[0].allowed === true) {
        console.log(`  [ok]   ${m.email} | ${key}`);
        continue;
      }

      // Upsert with allowed=true
      const id = nanoid();
      await sql`
        INSERT INTO user_permission (id, user_id, organization_id, permission_key, allowed, created_at, updated_at)
        VALUES (${id}, ${m.user_id}, ${m.organization_id}, ${key}, true, NOW(), NOW())
        ON CONFLICT (user_id, organization_id, permission_key)
        DO UPDATE SET allowed = true, updated_at = NOW()
      `;
      console.log(`  [set]  ${m.email} | ${key}`);
    }
  }

  console.log("\nDone. Final state:");
  const final = await sql`
    SELECT up.permission_key, up.allowed, u.email, m.role
    FROM user_permission up
    JOIN "user" u ON u.id = up.user_id
    JOIN member m ON m.user_id = up.user_id AND m.organization_id = up.organization_id
    WHERE m.role != 'owner' AND up.permission_key LIKE 'quotation%'
    ORDER BY u.email, up.permission_key
  `;
  for (const r of final) {
    console.log(`  ${r.allowed ? "✓" : "✗"} ${r.email} (${r.role}) | ${r.permission_key}`);
  }
}

run().catch(console.error);
