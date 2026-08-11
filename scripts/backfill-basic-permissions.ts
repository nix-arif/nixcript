import * as dotenv from "dotenv";
dotenv.config();
import { neon } from "@neondatabase/serverless";
import { nanoid } from "nanoid";
import { BASIC_PERMISSIONS } from "../lib/permissions/constants";

// Grants BASIC_PERMISSIONS to every active member-role user, regardless of
// department assignment — closes the gap where a member with no (or an
// incomplete) department assignment never received these baseline keys.
// Existing explicit rows (including revokes) are left untouched (DO NOTHING).

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  const members = await sql`
    SELECT user_id, organization_id
    FROM member
    WHERE deleted_at IS NULL AND role = 'member'
  `;

  let inserted = 0;
  let alreadyPresent = 0;

  for (const m of members) {
    for (const key of BASIC_PERMISSIONS) {
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
    `Backfilled ${inserted} new basic-permission rows across ${members.length} members ` +
    `(${alreadyPresent} already had explicit rows and were left untouched).`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
