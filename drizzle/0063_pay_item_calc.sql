-- Pay items gain a calculation type (fixed / per unit) and a monthly tax-free
-- limit, so case and petrol allowance become ordinary configurable items.
ALTER TABLE "pay_item" ADD COLUMN IF NOT EXISTS "calc_type" text NOT NULL DEFAULT 'fixed';
ALTER TABLE "pay_item" ADD COLUMN IF NOT EXISTS "unit_label" text;
ALTER TABLE "pay_item" ADD COLUMN IF NOT EXISTS "rate" text;
ALTER TABLE "pay_item" ADD COLUMN IF NOT EXISTS "tax_free_limit" text;

-- Former built-ins become ordinary items
UPDATE "pay_item" SET "system_key" = NULL, "calc_type" = 'per_unit', "unit_label" = 'case', "rate" = '100'
  WHERE "system_key" = 'case_allowance';
UPDATE "pay_item" SET "system_key" = NULL, "taxable" = true, "tax_free_limit" = '500'
  WHERE "system_key" = 'petrol_allowance';
