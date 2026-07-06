ALTER TABLE "quotation_item" ADD COLUMN IF NOT EXISTS "discount_source" text;
ALTER TABLE "quotation_item" ADD COLUMN IF NOT EXISTS "set_qty_source" text;
