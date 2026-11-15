-- Payslips keep only basic salary and the totals. Every other earning,
-- deduction and employer contribution becomes a payslip_line row, driven by
-- pay items (Payslip Settings).
CREATE TABLE IF NOT EXISTS "payslip_line" (
  "id" text PRIMARY KEY,
  "payslip_id" text NOT NULL REFERENCES "payslip"("id") ON DELETE CASCADE,
  "pay_item_id" text REFERENCES "pay_item"("id") ON DELETE SET NULL,
  "code" text,
  "kind" text NOT NULL,
  "label" text NOT NULL,
  "quantity" text,
  "rate" text,
  "amount" numeric(12,2) NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "payslip_line_payslip_idx" ON "payslip_line" ("payslip_id");
CREATE INDEX IF NOT EXISTS "payslip_line_pay_item_idx" ON "payslip_line" ("pay_item_id");

-- Bonus / overtime columns -> earning lines
INSERT INTO "payslip_line" ("id","payslip_id","pay_item_id","kind","label","amount","sort_order")
SELECT gen_random_uuid()::text, p."id", pi."id", 'earning', COALESCE(pi."name", 'Bonus'), NULLIF(p."bonus",'')::numeric, 0
FROM "payslip" p
LEFT JOIN "pay_item" pi ON pi."organization_id" = p."organization_id" AND pi."system_key" = 'bonus'
WHERE COALESCE(NULLIF(p."bonus",'')::numeric, 0) > 0;

INSERT INTO "payslip_line" ("id","payslip_id","pay_item_id","kind","label","amount","sort_order")
SELECT gen_random_uuid()::text, p."id", pi."id", 'earning', COALESCE(pi."name", 'Overtime'), NULLIF(p."overtime_pay",'')::numeric, 1
FROM "payslip" p
LEFT JOIN "pay_item" pi ON pi."organization_id" = p."organization_id" AND pi."system_key" = 'overtime'
WHERE COALESCE(NULLIF(p."overtime_pay",'')::numeric, 0) > 0;

-- JSON allowances -> earning lines, JSON other deductions -> deduction lines
INSERT INTO "payslip_line" ("id","payslip_id","pay_item_id","kind","label","quantity","rate","amount","sort_order")
SELECT gen_random_uuid()::text, p."id", pi."id", 'earning', x->>'label', x->>'quantity', x->>'rate', NULLIF(x->>'amount','')::numeric, 10
FROM "payslip" p
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p."allowances"::jsonb, '[]'::jsonb)) x
LEFT JOIN "pay_item" pi ON pi."organization_id" = p."organization_id" AND pi."kind" = 'earning' AND lower(pi."name") = lower(x->>'label')
WHERE COALESCE(NULLIF(x->>'amount','')::numeric, 0) > 0;

INSERT INTO "payslip_line" ("id","payslip_id","pay_item_id","kind","label","quantity","rate","amount","sort_order")
SELECT gen_random_uuid()::text, p."id", pi."id", 'deduction', x->>'label', x->>'quantity', x->>'rate', NULLIF(x->>'amount','')::numeric, 30
FROM "payslip" p
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p."other_deductions"::jsonb, '[]'::jsonb)) x
LEFT JOIN "pay_item" pi ON pi."organization_id" = p."organization_id" AND pi."kind" = 'deduction' AND lower(pi."name") = lower(x->>'label')
WHERE COALESCE(NULLIF(x->>'amount','')::numeric, 0) > 0;

-- Statutory columns -> coded deduction / employer lines
INSERT INTO "payslip_line" ("id","payslip_id","code","kind","label","amount","sort_order")
SELECT gen_random_uuid()::text, p."id", v.code, v.kind, v.label, v.amt, v.ord
FROM "payslip" p
CROSS JOIN LATERAL (VALUES
  ('epf',   'deduction', 'EPF',              NULLIF(p."epf_employee",'')::numeric,   20),
  ('socso', 'deduction', 'SOCSO',            NULLIF(p."socso_employee",'')::numeric, 21),
  ('eis',   'deduction', 'EIS',              NULLIF(p."eis_employee",'')::numeric,   22),
  ('pcb',   'deduction', 'PCB / LHDN',       NULLIF(p."lhdn",'')::numeric,           23),
  ('epf',   'employer',  'EPF (employer)',   NULLIF(p."epf_employer",'')::numeric,   40),
  ('socso', 'employer',  'SOCSO (employer)', NULLIF(p."socso_employer",'')::numeric, 41),
  ('eis',   'employer',  'EIS (employer)',   NULLIF(p."eis_employer",'')::numeric,   42)
) AS v(code, kind, label, amt, ord)
WHERE COALESCE(v.amt, 0) > 0;

-- Bonus / overtime become ordinary pay items
UPDATE "pay_item" SET "system_key" = NULL WHERE "system_key" IN ('bonus', 'overtime');

ALTER TABLE "payslip" DROP COLUMN IF EXISTS "bonus";
ALTER TABLE "payslip" DROP COLUMN IF EXISTS "overtime_pay";
ALTER TABLE "payslip" DROP COLUMN IF EXISTS "allowances";
ALTER TABLE "payslip" DROP COLUMN IF EXISTS "other_deductions";
ALTER TABLE "payslip" DROP COLUMN IF EXISTS "epf_employee";
ALTER TABLE "payslip" DROP COLUMN IF EXISTS "epf_employer";
ALTER TABLE "payslip" DROP COLUMN IF EXISTS "socso_employee";
ALTER TABLE "payslip" DROP COLUMN IF EXISTS "socso_employer";
ALTER TABLE "payslip" DROP COLUMN IF EXISTS "eis_employee";
ALTER TABLE "payslip" DROP COLUMN IF EXISTS "eis_employer";
ALTER TABLE "payslip" DROP COLUMN IF EXISTS "lhdn";
