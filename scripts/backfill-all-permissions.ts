import * as dotenv from "dotenv";
dotenv.config();
import { neon } from "@neondatabase/serverless";
import { nanoid } from "nanoid";
import { DEPT_ROLE_PERMISSIONS, ROLE_PERMISSIONS } from "../lib/permissions/constants";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  // All active members with their BA role (for stakeholder check)
  const members = await sql`
    SELECT id, user_id, organization_id, role
    FROM member
    WHERE deleted_at IS NULL
  `;

  // All dept assignments for active members
  const assignments = await sql`
    SELECT
      md.member_id,
      m.user_id,
      m.organization_id,
      d.name  AS dept_name,
      md.role AS dept_role
    FROM member_department md
    JOIN member m ON m.id = md.member_id
    JOIN department d ON d.id = md.department_id
    WHERE m.deleted_at IS NULL
  `;

  // Index assignments by member_id
  const byMember: Record<string, typeof assignments> = {};
  for (const a of assignments) {
    if (!byMember[a.member_id]) byMember[a.member_id] = [];
    byMember[a.member_id].push(a);
  }

  let inserted = 0;
  let skipped = 0;

  for (const m of members) {
    if (m.role === "owner") { skipped++; continue; }

    const permSet = new Set<string>();

    if (m.role === "stakeholder") {
      for (const p of ROLE_PERMISSIONS["stakeholder"] ?? []) permSet.add(p);
    } else {
      // Union all dept-role permissions
      for (const a of byMember[m.id] ?? []) {
        for (const p of DEPT_ROLE_PERMISSIONS[a.dept_name]?.[a.dept_role as "manager" | "member"] ?? []) {
          permSet.add(p);
        }
      }
    }

    if (permSet.size === 0) { skipped++; continue; }

    for (const key of permSet) {
      await sql`
        INSERT INTO user_permission (id, user_id, organization_id, permission_key, allowed)
        VALUES (${nanoid()}, ${m.user_id}, ${m.organization_id}, ${key}, true)
        ON CONFLICT (user_id, organization_id, permission_key) DO NOTHING
      `;
      inserted++;
    }

    console.log(`  ${m.user_id} → ${permSet.size} permissions`);
  }

  console.log(`\nDone. Inserted ${inserted} rows, skipped ${skipped} members (owners or no dept).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
