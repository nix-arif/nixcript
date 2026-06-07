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
