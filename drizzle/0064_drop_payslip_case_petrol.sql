-- Case and petrol allowance are ordinary pay items now (stored in
-- payslip.allowances). Move any value still in the old columns into
-- allowances, then drop the columns.
UPDATE "payslip"
SET "allowances" = (
  COALESCE("allowances"::jsonb, '[]'::jsonb)
  || CASE WHEN COALESCE("case_allowance_pay", '0')::numeric > 0
       THEN jsonb_build_array(jsonb_build_object('label', 'Case allowance', 'amount', "case_allowance_pay"))
       ELSE '[]'::jsonb END
  || CASE WHEN COALESCE("petrol_allowance_pay", '0')::numeric > 0
       THEN jsonb_build_array(jsonb_build_object('label', 'Petrol allowance', 'amount', "petrol_allowance_pay"))
       ELSE '[]'::jsonb END
)::json
WHERE COALESCE("case_allowance_pay", '0')::numeric > 0
   OR COALESCE("petrol_allowance_pay", '0')::numeric > 0;

ALTER TABLE "payslip" DROP COLUMN IF EXISTS "case_allowance_pay";
ALTER TABLE "payslip" DROP COLUMN IF EXISTS "petrol_allowance_pay";
