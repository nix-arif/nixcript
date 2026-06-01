import * as dotenv from "dotenv";
dotenv.config();
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  // Members and their dept assignments
  const members = await sql`
    SELECT m.id, m.user_id, m.organization_id, m.role, u.name, u.email
    FROM member m
    JOIN "user" u ON u.id = m.user_id
    WHERE m.deleted_at IS NULL
    ORDER BY u.name
  `;

  console.log(`\n=== Members (${members.length}) ===`);
  for (const m of members) {
    console.log(`\n[${m.name}] role=${m.role}`);

    const depts = await sql`
      SELECT d.name, md.role
      FROM member_department md
      JOIN department d ON d.id = md.department_id
      WHERE md.member_id = ${m.id}
    `;
    console.log(`  Depts: ${depts.length === 0 ? "(none)" : depts.map((d: any) => `${d.name}(${d.role})`).join(", ")}`);

    const perms = await sql`
      SELECT permission_key FROM user_permission
      WHERE user_id = ${m.user_id} AND organization_id = ${m.organization_id} AND allowed = true
      ORDER BY permission_key
    `;
    console.log(`  Permissions (${perms.length}): ${perms.length === 0 ? "(none)" : perms.map((p: any) => p.permission_key).join(", ")}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
