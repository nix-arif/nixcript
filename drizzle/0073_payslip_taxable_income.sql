-- Taxable income (the PCB base: basic salary + earnings marked for PCB) stored on each payslip
ALTER TABLE "payslip" ADD COLUMN IF NOT EXISTS "taxable_income" text;
UPDATE "payslip" p
SET "taxable_income" = (
  p."basic_salary"::numeric + COALESCE((
    SELECT SUM(l."amount")
    FROM "payslip_line" l
    JOIN "pay_item" i ON i."id" = l."pay_item_id"
    WHERE l."payslip_id" = p."id" AND l."kind" = 'earning' AND i."in_pcb" = true
  ), 0)
)::text
WHERE p."taxable_income" IS NULL;
