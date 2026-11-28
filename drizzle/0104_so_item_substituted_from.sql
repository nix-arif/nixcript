-- Substitute product on a sales order line: the code it was supplied in place of (null: not a substitute).
-- Run BEFORE the release that uses it: that code reads and writes this column; older code ignores it.
-- Only adds a nullable column; safe to run again.
ALTER TABLE "sales_order_item" ADD COLUMN IF NOT EXISTS "substituted_from_code" text;
