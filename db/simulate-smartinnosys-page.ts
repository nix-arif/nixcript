import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

function readUrl(file: string) {
  const m = readFileSync(file, "utf-8").match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error(`No DATABASE_URL in ${file}`);
  return m[1].trim().replace(/^["']|["']$/g, "");
}

async function run() {
  const sql = neon(readUrl(".env")); // prod

  const email = "smartinnosys@gmail.com";
  const orgId = "g63wYhdti8elZdv8yfaU00YQ2xYpP8DU"; // Smart Innosys Sdn Bhd

  // 1. Get user
  const [user] = await sql`SELECT id, email FROM "user" WHERE email = ${email}`;
  console.log("User:", user.id, user.email);
  const userId = user.id;

  // 2. Check permissions
  const perms = await sql`
    SELECT permission_key FROM user_permission
    WHERE user_id = ${userId} AND organization_id = ${orgId} AND allowed = true
    ORDER BY permission_key
  `;
  console.log("\nPermissions:", perms.map((p: any) => p.permission_key).join(", "));

  const permKeys = perms.map((p: any) => p.permission_key as string);
  const hasCreate = permKeys.includes("quotation:create");
  const hasCustomerRead = permKeys.includes("customer:read");
  console.log("Has quotation:create:", hasCreate);
  console.log("Has customer:read:", hasCustomerRead);

  // 3. Simulate getOwnerOrgId for customer
  const [ownerMember] = await sql`
    SELECT user_id FROM member WHERE organization_id = ${orgId} AND role = 'owner'
  `;
  console.log("\nOwner of Smart Innosys:", ownerMember?.user_id);

  if (ownerMember) {
    const [primaryOrg] = await sql`
      SELECT organization_id FROM member
      WHERE user_id = ${ownerMember.user_id} AND role = 'owner'
      ORDER BY created_at ASC LIMIT 1
    `;
    console.log("Primary org of owner:", primaryOrg?.organization_id);

    // Check if customers exist for this primary org
    const customers = await sql`
      SELECT COUNT(*) as count FROM customer WHERE organization_id = ${primaryOrg.organization_id}
    `;
    console.log("Customer count:", customers[0].count);

    // 4. Simulate peekNextQuotationNo
    const [org] = await sql`
      SELECT o.slug, o.name, op.quotation_no_format
      FROM organization o
      LEFT JOIN organization_profile op ON op.organization_id = o.id
      WHERE o.id = ${orgId} LIMIT 1
    `;
    console.log("\nOrg for quotation no:", org?.slug, org?.name, "format:", org?.quotation_no_format);

    const [counter] = await sql`
      SELECT last_number, year FROM quotation_counter
      WHERE organization_id = ${orgId} LIMIT 1
    `;
    console.log("Counter:", counter ?? "no existing counter");

    // 5. Simulate getAllOwnerOrgs
    const ownedOrgs = await sql`
      SELECT m.organization_id, o.name, o.slug
      FROM member m
      JOIN organization o ON o.id = m.organization_id
      WHERE m.user_id = ${ownerMember.user_id} AND m.role = 'owner'
      ORDER BY m.created_at ASC
    `;
    console.log("\nOwner orgs:", ownedOrgs.map((o: any) => `${o.name} (${o.organization_id})`).join(", "));
  }

  // 6. Simulate getOrgMembersForQuotation
  const members = await sql`
    SELECT m.user_id, u.name, u.email, m.role
    FROM member m
    INNER JOIN "user" u ON u.id = m.user_id
    WHERE m.organization_id = ${orgId}
    ORDER BY u.name
  `;
  console.log("\nOrg members:", members.map((m: any) => `${m.name} (${m.role})`).join(", "));
}

run().catch((e) => {
  console.error("CRASHED:", e.message);
  console.error(e);
});
