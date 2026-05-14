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
