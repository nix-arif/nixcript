-- Which customer each item belongs to. A Customer PO can combine quotations of different contacts of one customer
-- organization, so the customer is kept per item (CPO items live in a JSON column; sales order items get columns)
-- and carried on to the purchase requisition and the supplier PO.
ALTER TABLE "sales_order_item" ADD COLUMN IF NOT EXISTS "customer_id" text;
ALTER TABLE "sales_order_item" ADD COLUMN IF NOT EXISTS "customer_organization_id" text;
ALTER TABLE "sales_order_item" ADD COLUMN IF NOT EXISTS "customer_name" text;
ALTER TABLE "sales_order_item" ADD COLUMN IF NOT EXISTS "customer_organization" text;
