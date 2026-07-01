/**
 * One-time seed script for Playwright E2E test environment.
 * Safe to re-run — all steps are idempotent.
 *
 * Usage:
 *   npm run test:seed
 *
 * What it creates:
 *   1. Admin test account  (TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD)
 *   2. Staff test account  (TEST_STAFF_EMAIL  / TEST_STAFF_PASSWORD)
 *   3. Test organisation   (TEST_ORG_NAME) owned by admin
 *   4. Test department     (TEST_DEPT_NAME) inside the org
 */
import { db } from "@/db";
import { user, organization, member, department } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

function require(key: string) {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

const ADMIN_EMAIL    = require("TEST_ADMIN_EMAIL");
const ADMIN_PASSWORD = require("TEST_ADMIN_PASSWORD");
const ADMIN_NAME     = process.env.TEST_ADMIN_NAME ?? "Test Admin";
const STAFF_EMAIL    = require("TEST_STAFF_EMAIL");
const STAFF_PASSWORD = require("TEST_STAFF_PASSWORD");
const STAFF_NAME     = process.env.TEST_STAFF_NAME ?? "Test Staff";
const ORG_NAME       = process.env.TEST_ORG_NAME  ?? "Nixcript Test Org";
const DEPT_NAME      = process.env.TEST_DEPT_NAME ?? "test-dept";

async function registerAccount(name: string, email: string, password: string) {
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
  if (existing) {
    console.log(`  ✓ Account already exists: ${email}`);
    return existing.id;
  }

  await auth.api.signUpEmail({
    body: { name, email, password },
    headers: new Headers({ "Content-Type": "application/json" }),
  });

  const [created] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
  if (!created) throw new Error(`Failed to create account: ${email}`);
  console.log(`  ✓ Created account: ${email}`);
  return created.id;
}

async function getAdminHeaders(email: string, password: string) {
  const res = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  const setCookie = res.headers.get("set-cookie") ?? "";
  return new Headers({ Cookie: setCookie.split(",").map((c) => c.trim().split(";")[0]).join("; ") });
}

async function main() {
  console.log("\n── Seeding E2E test environment ──────────────────────────────────");

  // 1. Accounts
  console.log("\n[1/4] Accounts");
  const adminId = await registerAccount(ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD);
  await registerAccount(STAFF_NAME, STAFF_EMAIL, STAFF_PASSWORD);

  // 2. Organisation (owned by admin)
  console.log("\n[2/4] Organisation");
  const [existingOrg] = await db
    .select({ id: organization.id })
    .from(organization)
    .innerJoin(member, and(eq(member.organizationId, organization.id), eq(member.userId, adminId), eq(member.role, "owner")))
    .where(eq(organization.name, ORG_NAME))
    .limit(1);

  let orgId: string;
  if (existingOrg) {
    console.log(`  ✓ Org already exists: "${ORG_NAME}"`);
    orgId = existingOrg.id;
  } else {
    const adminHeaders = await getAdminHeaders(ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await auth.api.createOrganization({
      body: { name: ORG_NAME, slug: ORG_NAME.toLowerCase().replace(/\s+/g, "-") },
      headers: adminHeaders,
    });
    if (!res?.id) throw new Error("Failed to create organization");
    orgId = res.id;
    console.log(`  ✓ Created org: "${ORG_NAME}" (${orgId})`);
  }

  // 3. Department
  console.log("\n[3/4] Department");
  const [existingDept] = await db
    .select({ id: department.id })
    .from(department)
    .where(and(eq(department.organizationId, orgId), eq(department.name, DEPT_NAME)))
    .limit(1);

  if (existingDept) {
    console.log(`  ✓ Department already exists: "${DEPT_NAME}"`);
  } else {
    await db.insert(department).values({
      organizationId: orgId,
      name: DEPT_NAME,
      isDefault: false,
    });
    console.log(`  ✓ Created department: "${DEPT_NAME}"`);
  }

  console.log("\n── Done ───────────────────────────────────────────────────────────");
  console.log("Now add these to .env.local if not already set:");
  console.log(`  TEST_ADMIN_EMAIL=${ADMIN_EMAIL}`);
  console.log(`  TEST_STAFF_EMAIL=${STAFF_EMAIL}`);
  console.log(`  TEST_ORG_NAME=${ORG_NAME}`);
  console.log(`  TEST_DEPT_NAME=${DEPT_NAME}`);
  console.log("\nThen run: npm run test:e2e:ui\n");

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
