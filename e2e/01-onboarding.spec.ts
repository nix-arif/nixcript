/**
 * Onboarding flow: admin invites staff → staff accepts → admin assigns dept role
 *
 * Requires env vars in .env.local:
 *   TEST_ADMIN_EMAIL      admin account email
 *   TEST_ADMIN_PASSWORD   admin account password
 *   TEST_STAFF_EMAIL      staff account email (account must already exist — run npm run test:seed first)
 *   TEST_STAFF_PASSWORD   staff account password
 *   TEST_DEPT_NAME        department to invite staff into (e.g. "test-dept")
 *
 * Run seed first: npm run test:seed
 */
import { test, expect, Browser, chromium } from "@playwright/test";
import path from "path";

const STAFF_EMAIL = process.env.TEST_STAFF_EMAIL ?? "";
const DEPT_NAME   = process.env.TEST_DEPT_NAME   ?? "";

if (!STAFF_EMAIL) throw new Error("TEST_STAFF_EMAIL is not set in .env.local");
if (!DEPT_NAME)   throw new Error("TEST_DEPT_NAME is not set in .env.local");

test.describe("Onboarding: invite and accept", () => {

  // ── Step 1: Admin creates a department (idempotent) ─────────────────────────
  test("admin ensures test department exists", async ({ page }) => {
    await page.goto("/dashboard/organization/departments");

    const deptExists = await page.getByText(DEPT_NAME, { exact: false }).isVisible().catch(() => false);
    if (deptExists) {
      console.log(`  ✓ Department "${DEPT_NAME}" already exists`);
      return;
    }

    await page.getByPlaceholder("e.g. operations").fill(DEPT_NAME);
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText(DEPT_NAME, { exact: false })).toBeVisible({ timeout: 8_000 });
    console.log(`  ✓ Created department: ${DEPT_NAME}`);
  });

  // ── Step 2: Admin invites staff ─────────────────────────────────────────────
  test("admin invites staff user", async ({ page }) => {
    await page.goto("/dashboard/organization/invite");

    // Check if staff already in org (would show in pending or active members)
    const alreadyInvited = await page.getByText(STAFF_EMAIL).isVisible().catch(() => false);
    if (alreadyInvited) {
      console.log(`  ✓ ${STAFF_EMAIL} already invited/joined`);
      return;
    }

    // Fill email
    await page.getByPlaceholder("Enter email address...").fill(STAFF_EMAIL);

    // Select department
    const deptTrigger = page.locator("[data-slot=select-trigger]").filter({ hasText: "Department" }).first();
    await deptTrigger.click();
    await page.getByRole("option", { name: DEPT_NAME }).click();

    // Select role
    const roleTrigger = page.locator("[data-slot=select-trigger]").filter({ hasText: "Role" }).first();
    await roleTrigger.click();
    await page.getByRole("option", { name: "Member" }).click();

    // Send
    await page.getByRole("button", { name: /Send.*invitation/i }).click();
    await expect(page.getByText(/invitation.*sent|sent.*invitation/i).or(page.getByText(STAFF_EMAIL))).toBeVisible({ timeout: 10_000 });
    console.log(`  ✓ Invitation sent to ${STAFF_EMAIL}`);
  });

  // ── Step 3: Staff accepts invitation ────────────────────────────────────────
  test("staff accepts invitation", async ({ page, request }) => {
    // Get invite ID from dev-only helper endpoint
    const res = await request.get(`/api/test-helpers/invitation?email=${encodeURIComponent(STAFF_EMAIL)}`);
    const { id: invId } = await res.json();

    if (!invId) {
      console.log(`  ✓ No pending invitation for ${STAFF_EMAIL} — already accepted`);
      return;
    }

    // Load staff session in a separate browser context
    const staffBrowser = await chromium.launch();
    const staffCtx = await staffBrowser.newContext({
      storageState: path.join(__dirname, ".auth/staff.json"),
      baseURL: "http://localhost:3000",
    });
    const staffPage = await staffCtx.newPage();

    try {
      await staffPage.goto(`http://localhost:3000/api/accept-invitation/${invId}`);
      // Route redirects to /dashboard after acceptance
      await staffPage.waitForURL(/\/dashboard/, { timeout: 15_000 });
      console.log(`  ✓ Staff accepted invitation`);
    } finally {
      await staffBrowser.close();
    }

    // Verify staff appears in members list on admin side
    await page.goto("/dashboard/organization/members");
    await expect(page.getByText(STAFF_EMAIL)).toBeVisible({ timeout: 10_000 });
    console.log(`  ✓ Staff visible in members list`);
  });

});
