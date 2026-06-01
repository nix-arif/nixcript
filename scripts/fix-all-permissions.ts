import * as dotenv from "dotenv";
dotenv.config();
import { neon } from "@neondatabase/serverless";
import { nanoid } from "nanoid";
import { ALL_PERMISSIONS, DEPT_ROLE_PERMISSIONS, ROLE_PERMISSIONS } from "../lib/permissions/constants";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  // ── 1. Sync permission registry ──────────────────────────────────────────
  console.log("Syncing permission registry…");
  for (const p of ALL_PERMISSIONS) {
    await sql`
      INSERT INTO permission (id, key, label)
      VALUES (${nanoid()}, ${p.key}, ${p.label})
      ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label
    `;
  }
  console.log(`  ${ALL_PERMISSIONS.length} permissions synced.\n`);

  // ── 2. Recompute user_permission for every active member ─────────────────
  const members = await sql`
    SELECT m.id, m.user_id, m.organization_id, m.role, u.name
    FROM member m
    JOIN "user" u ON u.id = m.user_id
    WHERE m.deleted_at IS NULL
    ORDER BY u.name
  `;

  const assignments = await sql`
    SELECT md.member_id, d.name AS dept_name, md.role AS dept_role
    FROM member_department md
    JOIN member m ON m.id = md.member_id
    JOIN department d ON d.id = md.department_id
    WHERE m.deleted_at IS NULL
  `;

  const byMember: Record<string, { dept_name: string; dept_role: string }[]> = {};
  for (const a of assignments) {
    if (!byMember[a.member_id]) byMember[a.member_id] = [];
    byMember[a.member_id].push(a);
  }

  console.log("Recomputing user permissions…");
  for (const m of members) {
    if (m.role === "owner") {
      console.log(`  [${m.name}] owner — skipped`);
      continue;
    }

    const permSet = new Set<string>();

    if (m.role === "stakeholder") {
      for (const p of ROLE_PERMISSIONS["stakeholder"] ?? []) permSet.add(p);
    } else {
      for (const a of byMember[m.id] ?? []) {
        for (const p of DEPT_ROLE_PERMISSIONS[a.dept_name]?.[a.dept_role as "manager" | "member"] ?? []) {
          permSet.add(p);
        }
      }
    }

    if (permSet.size === 0) {
      console.log(`  [${m.name}] no dept assignments — skipped`);
      continue;
    }

    // Upsert: force allowed=true for all dept-derived permissions
    for (const key of permSet) {
      await sql`
        INSERT INTO user_permission (id, user_id, organization_id, permission_key, allowed)
        VALUES (${nanoid()}, ${m.user_id}, ${m.organization_id}, ${key}, true)
        ON CONFLICT (user_id, organization_id, permission_key)
        DO UPDATE SET allowed = true
      `;
    }

    console.log(`  [${m.name}] ${permSet.size} permissions upserted`);
  }

  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); });
