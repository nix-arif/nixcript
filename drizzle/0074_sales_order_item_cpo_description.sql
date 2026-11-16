-- The description as written on the customer's PO (and a set's title on it), kept on sales order items
ALTER TABLE "sales_order_item" ADD COLUMN IF NOT EXISTS "cpo_description" text;
ALTER TABLE "sales_order_item" ADD COLUMN IF NOT EXISTS "set_cpo_title" text;
