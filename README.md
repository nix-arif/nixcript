/auth/login
/auth/register

/dashboard ← overview/home

/dashboard/sales/quotation ← quotation:read
/dashboard/sales/quotation/create ← quotation:create
/dashboard/sales/order ← sales-order:read
/dashboard/sales/order/create ← sales-order:create

/dashboard/fulfillment/delivery ← delivery-order:read
/dashboard/fulfillment/delivery/create ← delivery-order:create
/dashboard/fulfillment/invoice ← invoice:read
/dashboard/fulfillment/invoice/create ← invoice:create

/dashboard/organization/members ← member:read
/dashboard/organization/invite ← member:invite
/dashboard/organization/roles ← organization-role:read (rename from members-settings)
/dashboard/organization/roles/create ← organization-role:create (rename from create-organization-role)

/dashboard/admin/permissions ← permission:read
/dashboard/admin/permissions/create ← permission:create

Then in a second terminal (keep your pnpm dev running in the first), run:
bash

pnpm dlx trigger.dev@latest dev

This connects your local machine to Trigger.dev's cloud so jobs can be picked up and executed. In production you'll deploy with:
bash

pnpm dlx trigger.dev@latest deploy

pnpm tsx scripts/migrate-permissions.ts

## INVENTORY WORKFLOW

Here's the complete workflow:

Setup (one-time)

1. Register your warehouses
   Go to Organization → Organization Profile → scroll to Warehouse Addresses → add each warehouse with a label (e.g. "KL Store", "JB Warehouse") and address.

2. Grant inventory permissions
   Go to Organization → Approvals → or manually in Members → assign:

inventory:read — anyone who needs to view stock
inventory:adjust — store staff who record stock movements
inventory:manage — managers who set reorder alerts 3. Seed your products
Products must exist first (via Product → Product Search). Inventory tracks quantities for those products.

Daily Operations
Receiving stock (Stock In)
When goods arrive from a supplier:

Inventory → Stock Overview → click Stock Movement
Select warehouse → product → type Stock In ↑
Enter quantity, unit cost (optional), reference no. (e.g. PO number)
Save → stock balance increases immediately
Issuing stock (Stock Out)
When goods are dispatched:

Stock Movement → type Stock Out ↓
Select the warehouse holding the stock → product → quantity
Reference the Sales Order or Delivery Order number
Save → balance decreases
Opening balance (first time)
For products you already have in stock before going live:

Stock Movement → type Opening Balance
Enter the existing quantity per warehouse
Transferring between warehouses
When moving goods from KL Store to JB Warehouse:

Click Transfer button (only visible when you have 2+ warehouses)
Select product → From → To → quantity
System creates two records (OUT from source, IN to destination)
Manual adjustment
For stock counts, damages, write-offs:

Stock Movement → type Adjustment (positive) or Stock Out (negative)
Add a note explaining the reason
Monitoring
Stock Overview — shows all products grouped by warehouse with:

On Hand = physical quantity
Reserved = allocated to open orders (future)
Available = On Hand − Reserved
Low stock badge = quantity is at or below the reorder point
Set reorder alerts (inventory:manage): click the ⚙ icon on any row → set the reorder point (e.g. 50 units). The row turns amber when stock hits that level.

## Movement History → full audit trail of every stock in/out/transfer with who did it and when.

How it works
Manager setup (one-time)

Go to Inventory → Field Stock → Holding Limits tab
Click Set Limit → pick a staff member, a product, and the max qty they're allowed to hold
Staff without a limit set can still request — no cap enforced
Staff requesting stock

Go to Inventory → Field Stock
Click Request Stock → pick the source warehouse, search for the product, enter qty and reason
If they'd exceed their holding limit, the request is blocked immediately with a clear error
Status shows Pending
Manager approving

Go to Field Stock → Requests tab — pending badge shows the count
Click ✓ on a request → adjust approved qty if needed → Approve & Transfer Stock
Stock is instantly transferred from the source warehouse to "Field - [Staff Name]" virtual warehouse
Limit is re-checked at approval too
Viewing allocations

Field Stock → Current Allocations tab shows all staff holdings with utilisation %
The "Field - [Name]" warehouse also appears on the main Stock Overview page like any other warehouse
Staff using stock with a customer

Create a Delivery Order, pick items, link to Sales Order
When marking as Delivered, STOCK_OUT comes from the staff's "Field - [Name]" warehouse (select it as the warehouse)
Returning unused stock

Go to Stock Overview → Transfer → move from "Field - [Name]" back to main warehouse

# How to Use the Standard PR → PO → GR Flow

Step 1 — Raise a Purchase Requisition (PR)
Go to Procurement → Requisitions & PO → New Requisition

Select a supplier (required)
Link a Sales Order (optional — leave blank for stock replenishment)
Fill in items, quantities, unit prices
Two options:
Save as Draft — saves with status Draft, gets a PR number like BMS-PR-2026-0001
Submit for Approval — moves to Awaiting Approval, notifies approvers
Step 2 — Approve the Requisition (PR → PO)
An approver opens the PR and clicks "Approve & Issue PO"

A new PO number is generated (e.g., BMS-PO-2026-0001)
Status changes to PO Confirmed
The detail page now shows the PR → PO trail: BMS-PR-2026-0001 → BMS-PO-2026-0001
PDF becomes available (the document you send to the supplier)
Approver can also:

Return for Revision — sends back to draft
Recall PO — pulls back a confirmed PO to draft
Step 3 — Record Goods Receipt (GR) when goods arrive
On the confirmed PO, click "Record Receipt" (in the Goods Receipts section)

Enter the received date
Enter qty received per item (can be less than ordered for partial delivery)
Submit → creates BMS-GR-2026-0001, stock is added to inventory automatically
If you receive a partial delivery, click "Record Receipt" again for the next delivery. The PO auto-closes when all quantities are fully received.

Document numbering summary
Phase Document Number format
Internal requisition Purchase Requisition BMS-PR-2026-0001
Approved, sent to supplier Supplier PO BMS-PO-2026-0001
Goods arrive Goods Receipt BMS-GR-2026-0001
What the list view shows
Amber "Purchase Req." chip = still in draft/awaiting approval phase — shows PR number
Blue "Supplier PO" chip = approved and confirmed — shows PO number

# Delivery Order & SO Relation

Task A — SO detail per-CPO fulfillment status (so-detail-client.tsx):

When the SO has multiple CPOs (order.cpoCustomers.length > 1), the "Reserved" section shows a table row per CPO with CPO number, customer name, a colored badge (Pending / DO created / Delivered), and a "Create DO" button only for undelivered CPOs
When the SO has one or zero CPOs, the original single "Create Delivery Order" button is shown unchanged
Task B — CPO picker step in DO create (create-do-client.tsx):

PrefillData now has customerPoId? and customerPoNo?
After selecting an SO in SoPicker, if it has >1 CPOs the flow pauses on a CPO selection screen; if exactly 1, it auto-selects; if 0, proceeds with all items
buildPrefill() filters SO items by sourceCustomerPoId for the chosen CPO, uses the CPO's customer snapshot, and sets customerPoId/customerPoNo
The linked SO banner in DoForm shows a CPO: {poNo} badge when a CPO is selected
handleSave passes customerPoId/customerPoNo through to createDeliveryOrder

# All the remaining errors are pre-existing (scripts, payroll page, auth library, etc.) — none related to my changes. The implementation is complete and clean.

Here's a summary of everything that was built:

Stock replenishment trigger (automatic)

When a sales order is approved, checkAndTriggerReplenishment runs (fire-and-forget, non-blocking) for every product on that SO. If a product's available stock (quantity − reservedQty) hits or drops below its reorderPoint, a draft replenishment PR is auto-created — unless a pending replenishment PR for that product already exists. The reorder quantity is maxStock − available if maxStock is set, otherwise equals reorderPoint.

Sample / demo / loaner ordering

The PR create form now has a Requisition Type toggle at the top: "Customer Order" (default, links to an SO) or "Sample / Demo" (no SO link, optional purpose text like "Trade show loaner stock"). When a GR is received against a PO that originated from a sample_demo PR, stock goes to the "Demo" warehouse bucket instead of "Default" — keeping it separate from sellable inventory.

Schema changes (already pushed)

purchaseRequisition.prType — "customer_order" (default) | "replenishment" | "sample_demo"
purchaseRequisition.samplePurpose — free text, used for sample/demo orders
UI

PR list shows orange "Replenishment" or teal "Sample / Demo" badge under the PR number for non-customer-order types
PR create form has the type selector with contextual description

# Implementation Plan: Invoice Payment via Journal Entries

Why this is non-trivial
Right now invoice.status and invoice.paidAmount are manually set fields (seeded from Excel). The end state is: payment status is derived from posted journal entries that reference the invoice, using the AR account balance per invoice as the source of truth.

You can't do this in one step because:

~hundreds of existing "paid" invoices have no corresponding journal entries
The ledger itself has no historical data yet
Changing how status works would break the SOA, reports, and commission tracking overnight
Phase 1 — Keep manual system, add the link (now)
Goal: Let the journal entry form tag a payment entry to a specific invoice, and surface that link on the invoice detail page. No change to how status is computed yet.

What to build:

ledgerEntry.referenceType = "INVOICE" already works — the form can already pick an invoice. Verify this actually saves referenceId = invoice.id.
On the invoice detail page, add a "Linked Journal Entries" section that queries ledgerEntry where referenceId = invoice.id — shows date, entry no, debit/credit totals, status. Read-only for now.
No schema changes needed.
Value: You can start posting real payment entries against invoices immediately and see them linked. The manual paidAmount/status still drives everything else.

Phase 2 — Add invoicePayment junction table (schema migration)
Goal: Formally record which journal entry lines represent payment against which invoice, and how much each line settles.

New table:

invoicePayment (
id, invoiceId → invoice.id,
ledgerEntryId → ledgerEntry.id,
ledgerLineId → ledgerLine.id, // the specific CR to AR
amount text, // how much of the invoice this line settles
createdAt
)
What to build:

Push schema to DB (additive, no data loss)
When posting a journal entry with referenceType = "INVOICE", auto-create invoicePayment rows for lines that credit the AR account
getInvoiceDetail enriched with payments[] from this table
Value: Clean audit trail of exactly which journal entry line paid which invoice and how much.

Phase 3 — Compute computedPaidAmount alongside manual fields
Goal: Show both values — the manually set amount (legacy) and the journal-entry-derived amount — so you can see the discrepancy and trust the new system before cutting over.

What to build:

getInvoiceDetail and getInvoices compute computedPaidAmount = sum(invoicePayment.amount) per invoice
Invoice detail shows both: "Recorded payment: RM X" (manual) and "From journal entries: RM Y"
A reconciliation view: invoices where the two values differ — these are the ones still needing journal entries
Value: You can work through your backlog of paid invoices and post journal entries for them, watching the reconciliation list shrink. No cutover risk.

Phase 4 — Migrate historical paid invoices
Goal: Create journal entries for all invoices that have status = "paid" but no invoicePayment rows.

What to build:

A script (or a UI "Migrate" button for admins) that for each fully-paid invoice with no journal entry:
Creates a posted journal entry: Dr AR (invoice amount), Cr Bank
Creates the invoicePayment row linking it
Run it once — the script is idempotent (skips invoices that already have entries)
Phase 5 — Cut over (when ready)
Goal: invoice.status and invoice.paidAmount are now derived from journal entries, not set manually.

What to build:

getInvoices / getInvoiceDetail compute status from invoicePayment total vs grandTotal:
0 paid → sent
0 < paid < grandTotal → partial
paid >= grandTotal → paid
Remove the manual markInvoicePaid server action (or keep it for exceptional overrides with a manualOverride flag)
The invoice list "Mark as Paid" button becomes "Post Payment Entry" — opens the journal entry form pre-filled with the correct AR debit
Suggested order
Phase When Risk
1 This week Zero — read-only link
2 Next sprint Low — additive schema
3 After phase 2 Low — display only
4 When backlog is small Medium — bulk data creation
5 When phase 4 is 100% done High — changes live behaviour
Start with Phase 1 — want me to implement it now?
