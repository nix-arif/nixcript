ALTER TABLE "sales_order_item"
  ADD COLUMN "code_source" text,
  ADD COLUMN "qty_source" text,
  ADD COLUMN "uom_source" text,
  ADD COLUMN "unit_price_source" text,
  ADD COLUMN "discount_source" text;
