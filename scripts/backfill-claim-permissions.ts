import * as dotenv from "dotenv";
dotenv.config();
import { neon } from "@neondatabase/serverless";
import { nanoid } from "nanoid";
import { DEPT_ROLE_PERMISSIONS } from "../lib/permissions/constants";

const CLAIM_KEYS = ["claim:read:own", "claim:apply", "claim:approve", "claim:manage"];

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  // All active member dept assignments
  const assignments = await sql`
    SELECT
      m.user_id,
      m.organization_id,
      d.name AS dept_name,
      md.role AS dept_role
    FROM member_department md
    JOIN member m ON m.id = md.member_id
    JOIN department d ON d.id = md.department_id
    WHERE m.deleted_at IS NULL
  `;

  // Build per-user claim permission set
  const userPermMap: Record<string, { userId: string; orgId: string; keys: Set<string> }> = {};

  for (const row of assignments) {
    const mapKey = `${row.user_id}::${row.organization_id}`;
    if (!userPermMap[mapKey]) {
      userPermMap[mapKey] = { userId: row.user_id, orgId: row.organization_id, keys: new Set() };
    }
    const perms = DEPT_ROLE_PERMISSIONS[row.dept_name]?.[row.dept_role as "manager" | "member"] ?? [];
    for (const p of perms) {
      if (CLAIM_KEYS.includes(p)) userPermMap[mapKey].keys.add(p);
    }
  }

  let inserted = 0;
  for (const { userId, orgId, keys } of Object.values(userPermMap)) {
    for (const key of keys) {
      await sql`
        INSERT INTO user_permission (id, user_id, organization_id, permission_key, allowed)
        VALUES (${nanoid()}, ${userId}, ${orgId}, ${key}, true)
        ON CONFLICT (user_id, organization_id, permission_key) DO NOTHING
      `;
      inserted++;
    }
  }

  console.log(`Backfilled ${inserted} claim permission rows for ${Object.keys(userPermMap).length} user-org pairs.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
