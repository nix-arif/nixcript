# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: so.spec.ts >> Sales Order >> create SO as draft
- Location: e2e/so.spec.ts:18:7

# Error details

```
TimeoutError: locator.waitFor: Timeout 8000ms exceeded.
Call log:
  - waiting for locator('button').filter({ hasText: 'KPJ' }).first() to be visible

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
            - heading "New Sales Order" [level=1] [ref=e186]
            - paragraph [ref=e187]: Create a new sales order
          - button "Back" [ref=e189]:
            - img
            - text: Back
        - generic [ref=e190]:
          - generic [ref=e191]:
            - heading "Order type" [level=2] [ref=e192]
            - generic [ref=e193]:
              - button "Standard" [ref=e194]
              - button "Pro-forma" [ref=e195]
          - generic [ref=e196]:
            - heading "Quotations *" [level=2] [ref=e198]
            - generic [ref=e200]:
              - img
              - textbox "Search quotation no.…" [ref=e201]
          - generic [ref=e202]:
            - heading "Customer POs (optional)" [level=2] [ref=e204]
            - generic [ref=e206] [cursor=pointer]:
              - generic [ref=e207]: Select customer POs…
              - img [ref=e208]
          - generic [ref=e210]:
            - heading "Customer" [level=2] [ref=e211]
            - generic [ref=e212]:
              - img [ref=e213]
              - textbox "Search customer by name..." [ref=e216]
          - generic [ref=e217]:
            - heading "Order details" [level=2] [ref=e218]
            - generic [ref=e219]:
              - generic [ref=e220]:
                - generic [ref=e221]: Sales person
                - generic [ref=e222]:
                  - combobox [ref=e223]:
                    - option "— Select —" [selected]
                    - option "arif"
                    - option "MohamadShahrizal"
                    - option "AMLI"
                    - option "AshrafTasrifin"
                  - combobox [ref=e224]:
                    - option "+ Add associate…" [selected]
                    - option "arif"
                    - option "MohamadShahrizal"
                    - option "AMLI"
                    - option "AshrafTasrifin"
              - generic [ref=e225]:
                - generic [ref=e227]: Due delivery date
                - textbox [ref=e228]
              - generic [ref=e229]:
                - generic [ref=e231]: Delivery address
                - textbox "Address" [ref=e232]
            - generic [ref=e233]:
              - generic [ref=e234]: Notes
              - textbox "Internal notes..." [ref=e235]
          - generic [ref=e236]:
            - generic [ref=e237]:
              - heading "Items" [level=2] [ref=e238]
              - button "Add row" [ref=e239]:
                - img
                - text: Add row
            - table [ref=e241]:
              - rowgroup [ref=e242]:
                - row "# Code Description Qty UOM Unit price Disc % Total" [ref=e243]:
                  - columnheader "#" [ref=e244]
                  - columnheader "Code" [ref=e245]
                  - columnheader "Description" [ref=e246]
                  - columnheader "Qty" [ref=e247]
                  - columnheader "UOM" [ref=e248]
                  - columnheader "Unit price" [ref=e249]
                  - columnheader "Disc %" [ref=e250]
                  - columnheader "Total" [ref=e251]
                  - columnheader [ref=e252]
              - rowgroup [ref=e253]:
                - row "1 1 0 0 RM 0.00" [ref=e254]:
                  - cell "1" [ref=e255]
                  - cell [ref=e256]:
                    - textbox "Code…" [ref=e258]
                  - cell [ref=e259]:
                    - textbox [ref=e260]
                  - cell "1" [ref=e261]:
                    - textbox [ref=e262]: "1"
                  - cell [ref=e263]:
                    - textbox "unit" [ref=e264]
                  - cell "0" [ref=e265]:
                    - textbox [ref=e266]: "0"
                  - cell "0" [ref=e267]:
                    - textbox [ref=e268]: "0"
                  - cell "RM 0.00" [ref=e269]
                  - cell [ref=e270]:
                    - button [disabled] [ref=e271]:
                      - img [ref=e272]
          - generic [ref=e275]:
            - heading "Pricing" [level=2] [ref=e276]
            - generic [ref=e278]:
              - generic [ref=e279]:
                - generic [ref=e280]: Subtotal
                - generic [ref=e281]: RM 0.00
              - generic [ref=e282]:
                - generic [ref=e283]: Overall disc.
                - generic [ref=e284]:
                  - textbox [ref=e285]: "0"
                  - generic [ref=e286]: "%"
                - generic [ref=e287]: −RM 0.00
              - generic [ref=e288]:
                - generic [ref=e289]: SST
                - generic [ref=e290]:
                  - textbox [ref=e291]: "0"
                  - generic [ref=e292]: "%"
                - generic [ref=e293]: RM 0.00
              - generic [ref=e294]:
                - generic [ref=e295]: Grand total
                - generic [ref=e296]: RM 0.00
          - generic [ref=e297]:
            - button "Create & Submit" [ref=e298]
            - button "Save as Draft" [ref=e299]
            - button "Cancel" [ref=e300]
  - region "Notifications alt+T"
  - button "Open Next.js Dev Tools" [ref=e306] [cursor=pointer]:
    - img [ref=e307]
  - alert [ref=e310]
```

# Test source

```ts
  1  | /**
  2  |  * Sales Order — create → submit → approve
  3  |  *
  4  |  * Required env vars in .env.local:
  5  |  *   TEST_CUSTOMER_NAME   partial customer name to search  (e.g. "KPJ")
  6  |  *   TEST_PRODUCT_CODE    product code to add as line item (e.g. "BMS-001")
  7  |  */
  8  | import { test, expect } from "@playwright/test";
  9  | 
  10 | const CUSTOMER = process.env.TEST_CUSTOMER_NAME ?? "";
  11 | const PRODUCT  = process.env.TEST_PRODUCT_CODE  ?? "";
  12 | 
  13 | if (!CUSTOMER) throw new Error("TEST_CUSTOMER_NAME is not set in .env.local");
  14 | if (!PRODUCT)  throw new Error("TEST_PRODUCT_CODE is not set in .env.local");
  15 | 
  16 | test.describe("Sales Order", () => {
  17 | 
  18 |   test("create SO as draft", async ({ page }) => {
  19 |     await page.goto("/dashboard/sales/order/create");
  20 | 
  21 |     // ── Customer ─────────────────────────────────────────────────────────────
  22 |     await page.getByPlaceholder("Search customer by name...").pressSequentially(CUSTOMER, { delay: 80 });
  23 |     const firstSuggestion = page.locator("button").filter({ hasText: CUSTOMER }).first();
> 24 |     await firstSuggestion.waitFor({ timeout: 8_000 });
     |                           ^ TimeoutError: locator.waitFor: Timeout 8000ms exceeded.
  25 |     await firstSuggestion.click();
  26 | 
  27 |     // ── Line item ─────────────────────────────────────────────────────────────
  28 |     await page.getByPlaceholder("Code…").pressSequentially(PRODUCT, { delay: 80 });
  29 |     // Wait for debounce + API (300ms debounce + round trip)
  30 |     await page.waitForTimeout(800);
  31 |     // Exact match → auto-selected, dropdown closes immediately. Partial match → click dropdown.
  32 |     const productOption = page.locator("button").filter({ hasText: PRODUCT }).first();
  33 |     const dropdownVisible = await productOption.isVisible();
  34 |     if (dropdownVisible) await productOption.click();
  35 | 
  36 |     await page.locator('[data-col="2"]').first().fill("1");
  37 |     await page.locator('[data-col="4"]').first().fill("100");
  38 | 
  39 |     // ── Save ──────────────────────────────────────────────────────────────────
  40 |     await page.getByRole("button", { name: "Save as Draft" }).click();
  41 | 
  42 |     // Wait for redirect to detail page (not create page)
  43 |     await page.waitForURL(
  44 |       (url) => url.pathname.includes("/sales/order/") && !url.pathname.endsWith("/create"),
  45 |       { timeout: 15_000 },
  46 |     );
  47 | 
  48 |     // SO number appears in the <h1>
  49 |     await expect(page.locator("h1").filter({ hasText: /SOSI?\// })).toBeVisible({ timeout: 10_000 });
  50 | 
  51 |     const soNo = await page.locator("h1").filter({ hasText: /SOSI?\// }).textContent();
  52 |     console.log("Created SO:", soNo?.trim());
  53 |   });
  54 | 
  55 |   test("submit SO for approval", async ({ page }) => {
  56 |     await page.goto("/dashboard/sales/order");
  57 |     await page.locator("h1, td, a").filter({ hasText: /SOSI?\// }).first().click();
  58 |     await page.waitForURL(
  59 |       (url) => url.pathname.includes("/sales/order/") && !url.pathname.endsWith("/create"),
  60 |       { timeout: 10_000 },
  61 |     );
  62 |     await page.getByRole("button", { name: "Submit for approval" }).click();
  63 |     await expect(page.getByText(/submitted|sent for approval/i)).toBeVisible({ timeout: 10_000 });
  64 |   });
  65 | 
  66 |   test("approve SO", async ({ page }) => {
  67 |     await page.goto("/dashboard/sales/order");
  68 |     await page.locator("h1, td, a").filter({ hasText: /SOSI?\// }).first().click();
  69 |     await page.waitForURL(
  70 |       (url) => url.pathname.includes("/sales/order/") && !url.pathname.endsWith("/create"),
  71 |       { timeout: 10_000 },
  72 |     );
  73 |     await page.getByRole("button", { name: "Approve" }).click();
  74 |     await expect(page.getByText(/confirmed/i)).toBeVisible({ timeout: 10_000 });
  75 |   });
  76 | });
  77 | 
```