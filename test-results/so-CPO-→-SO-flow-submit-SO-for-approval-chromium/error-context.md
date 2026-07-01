# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: so.spec.ts >> CPO → SO flow >> submit SO for approval
- Location: e2e/so.spec.ts:81:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('a, td, div').filter({ hasText: /SOSI?\// }).first()

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - generic [ref=e5]:
      - list [ref=e7]:
        - listitem [ref=e8]:
          - button "Affirma Sdn Bhd Affirma Sdn Bhd Workspace" [ref=e9]:
            - img "Affirma Sdn Bhd" [ref=e10]
            - generic [ref=e11]:
              - generic [ref=e12]: Affirma Sdn Bhd
              - generic [ref=e13]: Workspace
            - img [ref=e14]
      - list [ref=e20]:
        - listitem [ref=e21]:
          - button "Overview" [ref=e22]:
            - img [ref=e24]
            - generic [ref=e29]: Overview
            - img [ref=e30]
        - listitem [ref=e32]:
          - button "Sales" [expanded] [ref=e33]:
            - img [ref=e35]
            - generic [ref=e39]: Sales
            - img [ref=e40]
          - list [ref=e43]:
            - listitem [ref=e44]:
              - link "Customers" [ref=e45] [cursor=pointer]:
                - /url: /dashboard/sales/customer
            - listitem [ref=e46]:
              - link "Quotations" [ref=e47] [cursor=pointer]:
                - /url: /dashboard/sales/quotation
            - listitem [ref=e48]:
              - link "Customer POs" [ref=e49] [cursor=pointer]:
                - /url: /dashboard/sales/customer-po
            - listitem [ref=e50]:
              - link "Sales Orders" [ref=e51] [cursor=pointer]:
                - /url: /dashboard/sales/order
            - listitem [ref=e52]:
              - link "Consignment" [ref=e53] [cursor=pointer]:
                - /url: /dashboard/sales/consignment
        - listitem [ref=e54]:
          - button "Procurement" [ref=e55]:
            - img [ref=e57]
            - generic [ref=e60]: Procurement
            - img [ref=e61]
        - listitem [ref=e63]:
          - button "Fulfillment" [ref=e64]:
            - img [ref=e66]
            - generic [ref=e71]: Fulfillment
            - img [ref=e72]
        - listitem [ref=e74]:
          - button "Ledger" [ref=e75]:
            - img [ref=e77]
            - generic [ref=e79]: Ledger
            - img [ref=e80]
        - listitem [ref=e82]:
          - button "Product" [ref=e83]:
            - img [ref=e85]
            - generic [ref=e89]: Product
            - img [ref=e90]
        - listitem [ref=e92]:
          - button "Inventory" [ref=e93]:
            - img [ref=e95]
            - generic [ref=e98]: Inventory
            - img [ref=e99]
        - listitem [ref=e101]:
          - button "Organization" [ref=e102]:
            - img [ref=e104]
            - generic [ref=e109]: Organization
            - img [ref=e110]
        - listitem [ref=e112]:
          - button "Projects" [ref=e113]:
            - img [ref=e115]
            - generic [ref=e117]: Projects
            - img [ref=e118]
        - listitem [ref=e120]:
          - button "Human Resources" [ref=e121]:
            - img [ref=e123]
            - generic [ref=e128]: Human Resources
            - img [ref=e129]
        - listitem [ref=e131]:
          - button "Admin" [ref=e132]:
            - img [ref=e134]
            - generic [ref=e136]: Admin
            - img [ref=e137]
        - listitem [ref=e139]:
          - button "Profile" [ref=e140]:
            - img [ref=e142]
            - generic [ref=e145]: Profile
            - img [ref=e146]
        - listitem [ref=e148]:
          - button "Tools" [ref=e149]:
            - img [ref=e151]
            - generic [ref=e153]: Tools
            - img [ref=e154]
      - list [ref=e157]:
        - listitem [ref=e158]:
          - button "A arif nix.arif@gmail.com" [ref=e159]:
            - generic [ref=e161]: A
            - generic [ref=e162]:
              - generic [ref=e163]: arif
              - generic [ref=e164]: nix.arif@gmail.com
            - img [ref=e165]
      - button "Toggle Sidebar" [ref=e168]
    - main [ref=e169]:
      - generic [ref=e171]:
        - button "Toggle Sidebar" [ref=e172]:
          - img
          - generic [ref=e173]: Toggle Sidebar
        - generic [ref=e174]:
          - button "Notifications" [ref=e176]:
            - img [ref=e177]
            - generic [ref=e180]: "3"
          - img "logo" [ref=e181]
      - generic [ref=e183]:
        - generic [ref=e184]:
          - generic [ref=e185]:
            - heading "Sales Orders" [level=1] [ref=e186]
            - paragraph [ref=e187]: Track and manage sales orders
          - button "New SO" [ref=e189]:
            - img
            - text: New SO
        - generic [ref=e190]:
          - img [ref=e191]
          - textbox "Search by SO no., customer, status..." [ref=e194]
        - generic [ref=e195]: 0 orders
        - generic [ref=e196]:
          - img [ref=e197]
          - generic [ref=e200]: No sales orders yet
          - generic [ref=e201]: Create your first sales order to get started
          - button "New SO" [ref=e202]:
            - img
            - text: New SO
  - region "Notifications alt+T"
  - button "Open Next.js Dev Tools" [ref=e208] [cursor=pointer]:
    - img [ref=e209]
  - alert [ref=e212]
```

# Test source

```ts
  1   | /**
  2   |  * Full flow: CPO → SO (linked) → submit → approve
  3   |  *
  4   |  * Required env vars in .env.local:
  5   |  *   TEST_CUSTOMER_NAME   partial customer name to search  (e.g. "KPJ")
  6   |  *   TEST_PRODUCT_CODE    product code to add as line item (e.g. "H128-15")
  7   |  */
  8   | import { test, expect } from "@playwright/test";
  9   | 
  10  | const CUSTOMER = process.env.TEST_CUSTOMER_NAME ?? "";
  11  | const PRODUCT  = process.env.TEST_PRODUCT_CODE  ?? "";
  12  | 
  13  | if (!CUSTOMER) throw new Error("TEST_CUSTOMER_NAME is not set in .env.local");
  14  | if (!PRODUCT)  throw new Error("TEST_PRODUCT_CODE is not set in .env.local");
  15  | 
  16  | // Unique CPO number per run so it doesn't clash with previous test data
  17  | const CPO_NO = `TEST-CPO-${Date.now()}`;
  18  | 
  19  | test.describe("CPO → SO flow", () => {
  20  | 
  21  |   // ── Step 1: Create CPO ──────────────────────────────────────────────────────
  22  |   test("create CPO", async ({ page }) => {
  23  |     await page.goto("/dashboard/sales/customer-po/create");
  24  | 
  25  |     await page.getByPlaceholder("e.g. HOSPITAL-PO-2025-001").fill(CPO_NO);
  26  |     await page.getByRole("button", { name: "Record customer PO" }).click();
  27  | 
  28  |     // Redirects to CPO detail — CPO number appears in the h1
  29  |     await page.waitForURL(
  30  |       (url) => url.pathname.includes("/customer-po/") && !url.pathname.endsWith("/create"),
  31  |       { timeout: 15_000 },
  32  |     );
  33  |     await expect(page.locator("h1").filter({ hasText: CPO_NO })).toBeVisible({ timeout: 10_000 });
  34  |     console.log("Created CPO:", CPO_NO);
  35  |   });
  36  | 
  37  |   // ── Step 2: Create SO linked to that CPO ────────────────────────────────────
  38  |   test("create SO linked to CPO", async ({ page }) => {
  39  |     await page.goto("/dashboard/sales/order/create");
  40  | 
  41  |     // ── Customer ───────────────────────────────────────────────────────────────
  42  |     await page.getByPlaceholder("Search customer by name...").pressSequentially(CUSTOMER, { delay: 80 });
  43  |     const firstCustomer = page.locator("button").filter({ hasText: CUSTOMER }).first();
  44  |     await firstCustomer.waitFor({ timeout: 8_000 });
  45  |     await firstCustomer.click();
  46  | 
  47  |     // ── Link CPO ───────────────────────────────────────────────────────────────
  48  |     await page.getByText("Select customer POs…").click();
  49  |     await page.getByPlaceholder("Search by PO number…").pressSequentially(CPO_NO.slice(0, 8), { delay: 80 });
  50  |     await page.waitForTimeout(600);
  51  |     const cpoOption = page.locator("button").filter({ hasText: CPO_NO }).first();
  52  |     await cpoOption.waitFor({ timeout: 8_000 });
  53  |     await cpoOption.click();
  54  |     // Close CPO dropdown by clicking outside
  55  |     await page.keyboard.press("Escape");
  56  | 
  57  |     // ── Line item ──────────────────────────────────────────────────────────────
  58  |     await page.getByPlaceholder("Code…").pressSequentially(PRODUCT, { delay: 80 });
  59  |     await page.waitForTimeout(800);
  60  |     const productOption = page.locator("button").filter({ hasText: PRODUCT }).first();
  61  |     const dropdownVisible = await productOption.isVisible();
  62  |     if (dropdownVisible) await productOption.click();
  63  | 
  64  |     await page.locator('[data-col="2"]').first().fill("1");
  65  |     await page.locator('[data-col="4"]').first().fill("100");
  66  | 
  67  |     // ── Save ───────────────────────────────────────────────────────────────────
  68  |     await page.getByRole("button", { name: "Save as Draft" }).click();
  69  | 
  70  |     await page.waitForURL(
  71  |       (url) => url.pathname.includes("/sales/order/") && !url.pathname.endsWith("/create"),
  72  |       { timeout: 15_000 },
  73  |     );
  74  |     await expect(page.locator("h1").filter({ hasText: /SOSI?\// })).toBeVisible({ timeout: 10_000 });
  75  | 
  76  |     const soNo = await page.locator("h1").filter({ hasText: /SOSI?\// }).textContent();
  77  |     console.log("Created SO:", soNo?.trim(), "← linked to", CPO_NO);
  78  |   });
  79  | 
  80  |   // ── Step 3: Submit SO ────────────────────────────────────────────────────────
  81  |   test("submit SO for approval", async ({ page }) => {
  82  |     await page.goto("/dashboard/sales/order");
> 83  |     await page.locator("a, td, div").filter({ hasText: /SOSI?\// }).first().click();
      |                                                                             ^ Error: locator.click: Test timeout of 30000ms exceeded.
  84  |     await page.waitForURL(
  85  |       (url) => url.pathname.includes("/sales/order/") && !url.pathname.endsWith("/create"),
  86  |       { timeout: 10_000 },
  87  |     );
  88  |     await page.getByRole("button", { name: "Submit for approval" }).click();
  89  |     await expect(page.getByText(/submitted|sent for approval/i)).toBeVisible({ timeout: 10_000 });
  90  |   });
  91  | 
  92  |   // ── Step 4: Approve SO ───────────────────────────────────────────────────────
  93  |   test("approve SO", async ({ page }) => {
  94  |     await page.goto("/dashboard/sales/order");
  95  |     await page.locator("a, td, div").filter({ hasText: /SOSI?\// }).first().click();
  96  |     await page.waitForURL(
  97  |       (url) => url.pathname.includes("/sales/order/") && !url.pathname.endsWith("/create"),
  98  |       { timeout: 10_000 },
  99  |     );
  100 |     await page.getByRole("button", { name: "Approve" }).click();
  101 |     await expect(page.getByText(/confirmed/i)).toBeVisible({ timeout: 10_000 });
  102 |   });
  103 | });
  104 | 
```