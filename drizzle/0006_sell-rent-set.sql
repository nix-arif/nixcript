-- Add sell/rent line type, rental duration, and set-grouping columns
-- to quotation_item and sales_order_item

ALTER TABLE "quotation_item"
  ADD COLUMN "line_type"       text NOT NULL DEFAULT 'sell',
  ADD COLUMN "rental_duration" text,
  ADD COLUMN "rental_unit"     text,
  ADD COLUMN "set_group_id"    text,
  ADD COLUMN "set_group_label" text,
  ADD COLUMN "set_qty"         text;

ALTER TABLE "sales_order_item"
  ADD COLUMN "line_type"       text NOT NULL DEFAULT 'sell',
  ADD COLUMN "rental_duration" text,
  ADD COLUMN "rental_unit"     text,
  ADD COLUMN "set_group_id"    text,
  ADD COLUMN "set_group_label" text,
  ADD COLUMN "set_qty"         text;
