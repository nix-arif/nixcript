-- Per-set subtitle on quotation items, printed under the set name. Every item
-- of one set carries the same value (enforced at spreadsheet import).
ALTER TABLE "quotation_item" ADD COLUMN "set_subtitle" text;

-- Remove the quotation-level subtitle column from the earlier, reverted attempt
-- (no-op if it was never applied).
ALTER TABLE "quotation" DROP COLUMN IF EXISTS "subtitle";
