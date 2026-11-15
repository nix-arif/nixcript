-- Built-in pay items (bonus, overtime, case/petrol allowance) are rows in pay_item
-- flagged with a system_key so the payslip form is driven entirely by pay items.
ALTER TABLE "pay_item" ADD COLUMN IF NOT EXISTS "system_key" text;
