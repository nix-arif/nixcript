/**
 * Full flow: CPO → SO (linked) → submit → approve
 *
 * Required env vars in .env.local:
 *   TEST_CUSTOMER_NAME   partial customer name to search  (e.g. "KPJ")
 *   TEST_PRODUCT_CODE    product code to add as line item (e.g. "H128-15")
 */
import { test, expect } from "@playwright/test";

const CUSTOMER = process.env.TEST_CUSTOMER_NAME ?? "";
const PRODUCT  = process.env.TEST_PRODUCT_CODE  ?? "";

if (!CUSTOMER) throw new Error("TEST_CUSTOMER_NAME is not set in .env.local");
if (!PRODUCT)  throw new Error("TEST_PRODUCT_CODE is not set in .env.local");

// Unique CPO number per run so it doesn't clash with previous test data
const CPO_NO = `TEST-CPO-${Date.now()}`;

test.describe("CPO → SO flow", () => {

  // ── Step 1: Create CPO ──────────────────────────────────────────────────────
  test("create CPO", async ({ page }) => {
    await page.goto("/dashboard/sales/customer-po/create");

    await page.getByPlaceholder("e.g. HOSPITAL-PO-2025-001").fill(CPO_NO);
    await page.getByRole("button", { name: "Record customer PO" }).click();

    // Redirects to CPO detail — CPO number appears in the h1
    await page.waitForURL(
      (url) => url.pathname.includes("/customer-po/") && !url.pathname.endsWith("/create"),
      { timeout: 15_000 },
    );
    await expect(page.locator("h1").filter({ hasText: CPO_NO })).toBeVisible({ timeout: 10_000 });
    console.log("Created CPO:", CPO_NO);
  });

  // ── Step 2: Create SO linked to that CPO ────────────────────────────────────
  test("create SO linked to CPO", async ({ page }) => {
    await page.goto("/dashboard/sales/order/create");

    // ── Customer ───────────────────────────────────────────────────────────────
    await page.getByPlaceholder("Search customer by name...").pressSequentially(CUSTOMER, { delay: 80 });
    const firstCustomer = page.locator("button").filter({ hasText: CUSTOMER }).first();
    await firstCustomer.waitFor({ timeout: 8_000 });
    await firstCustomer.click();

    // ── Link CPO ───────────────────────────────────────────────────────────────
    await page.getByText("Select customer POs…").click();
    await page.getByPlaceholder("Search by PO number…").pressSequentially(CPO_NO.slice(0, 8), { delay: 80 });
    await page.waitForTimeout(600);
    const cpoOption = page.locator("button").filter({ hasText: CPO_NO }).first();
    await cpoOption.waitFor({ timeout: 8_000 });
    await cpoOption.click();
    // Close CPO dropdown by clicking outside
    await page.keyboard.press("Escape");

    // ── Line item ──────────────────────────────────────────────────────────────
    await page.getByPlaceholder("Code…").pressSequentially(PRODUCT, { delay: 80 });
    await page.waitForTimeout(800);
    const productOption = page.locator("button").filter({ hasText: PRODUCT }).first();
    const dropdownVisible = await productOption.isVisible();
    if (dropdownVisible) await productOption.click();

    await page.locator('[data-col="2"]').first().fill("1");
    await page.locator('[data-col="4"]').first().fill("100");

    // ── Save ───────────────────────────────────────────────────────────────────
    await page.getByRole("button", { name: "Save as Draft" }).click();

    await page.waitForURL(
      (url) => url.pathname.includes("/sales/order/") && !url.pathname.endsWith("/create"),
      { timeout: 15_000 },
    );
    await expect(page.locator("h1").filter({ hasText: /SOSI?\// })).toBeVisible({ timeout: 10_000 });

    const soNo = await page.locator("h1").filter({ hasText: /SOSI?\// }).textContent();
    console.log("Created SO:", soNo?.trim(), "← linked to", CPO_NO);
  });

  // ── Step 3: Submit SO ────────────────────────────────────────────────────────
  test("submit SO for approval", async ({ page }) => {
    await page.goto("/dashboard/sales/order");
    await page.locator("a, td, div").filter({ hasText: /SOSI?\// }).first().click();
    await page.waitForURL(
      (url) => url.pathname.includes("/sales/order/") && !url.pathname.endsWith("/create"),
      { timeout: 10_000 },
    );
    await page.getByRole("button", { name: "Submit for approval" }).click();
    await expect(page.getByText(/submitted|sent for approval/i)).toBeVisible({ timeout: 10_000 });
  });

  // ── Step 4: Approve SO ───────────────────────────────────────────────────────
  test("approve SO", async ({ page }) => {
    await page.goto("/dashboard/sales/order");
    await page.locator("a, td, div").filter({ hasText: /SOSI?\// }).first().click();
    await page.waitForURL(
      (url) => url.pathname.includes("/sales/order/") && !url.pathname.endsWith("/create"),
      { timeout: 10_000 },
    );
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText(/confirmed/i)).toBeVisible({ timeout: 10_000 });
  });
});
