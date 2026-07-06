-- purchase_order_item: add set group fields
ALTER TABLE "purchase_order_item" ADD COLUMN IF NOT EXISTS "set_group_id" text;
ALTER TABLE "purchase_order_item" ADD COLUMN IF NOT EXISTS "set_group_label" text;
ALTER TABLE "purchase_order_item" ADD COLUMN IF NOT EXISTS "set_qty" text;

-- delivery_order_item: add set group fields
ALTER TABLE "delivery_order_item" ADD COLUMN IF NOT EXISTS "set_group_id" text;
ALTER TABLE "delivery_order_item" ADD COLUMN IF NOT EXISTS "set_group_label" text;
ALTER TABLE "delivery_order_item" ADD COLUMN IF NOT EXISTS "set_qty" text;

-- sales_order: add sets multiplier
ALTER TABLE "sales_order" ADD COLUMN IF NOT EXISTS "sets" integer NOT NULL DEFAULT 1;

-- invoice: add sets multiplier
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "sets" integer NOT NULL DEFAULT 1;
