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

Movement History → full audit trail of every stock in/out/transfer with who did it and when.
