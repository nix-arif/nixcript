-- Case allowance on a payslip is pulled from the Allowance module
-- (invoice_allowance). A payslip reserves the rows it includes; they are
-- marked paid when the payroll period is published.
ALTER TABLE "invoice_allowance" ADD COLUMN IF NOT EXISTS "payslip_id" text REFERENCES "payslip"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "invoice_allowance_payslip_idx" ON "invoice_allowance" ("payslip_id");

-- The default "Case allowance" item (cases x RM100) becomes the invoice-backed one
UPDATE "pay_item" SET "calc_type" = 'invoice_allowance', "unit_label" = NULL, "rate" = NULL, "recurring" = false
  WHERE "calc_type" = 'per_unit' AND "unit_label" = 'case' AND lower("name") = 'case allowance';
