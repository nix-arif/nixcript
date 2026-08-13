import * as dotenv from "dotenv";
dotenv.config();
import { neon } from "@neondatabase/serverless";
import { nanoid } from "nanoid";

// Grants the new travel:read:own + travel:apply baseline keys to every
// non-owner, non-stakeholder member — including custom-named org roles
// (e.g. "finance manager") that already have explicit user_permission rows
// and therefore never fall back to the live DEPT_ROLE_PERMISSIONS resolution
// (once a user has any explicit rows, resolvePermissions() reads only from
// user_permission and ignores the constants file entirely). Existing rows,
// including deliberate revokes, are left untouched (DO NOTHING).

const NEW_BASELINE_KEYS = ["travel:read:own", "travel:apply"];

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  const members = await sql`
    SELECT user_id, organization_id
    FROM member
    WHERE deleted_at IS NULL AND role NOT IN ('owner', 'stakeholder')
  `;

  let inserted = 0;
  let alreadyPresent = 0;

  for (const m of members) {
    for (const key of NEW_BASELINE_KEYS) {
      const result = await sql`
        INSERT INTO user_permission (id, user_id, organization_id, permission_key, allowed)
        VALUES (${nanoid()}, ${m.user_id}, ${m.organization_id}, ${key}, true)
        ON CONFLICT (user_id, organization_id, permission_key) DO NOTHING
        RETURNING id
      `;
      if (result.length > 0) inserted++;
      else alreadyPresent++;
    }
  }

  console.log(
    `Backfilled ${inserted} new travel-permission rows across ${members.length} non-owner/stakeholder members ` +
    `(${alreadyPresent} already had explicit rows and were left untouched).`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
