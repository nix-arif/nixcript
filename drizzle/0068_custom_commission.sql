-- Custom Commission: HR-defined commission types with roles (mapped to people on
-- the invoice) and a normalized rate per role x category x day type.
-- Replaces category_allowance_rate / member_allowance_rate (wide columns) and
-- organization_profile.allowance_multi_sales_person_mode (now per role).
CREATE TABLE IF NOT EXISTS "commission_type" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "commission_type_org_name_uidx" ON "commission_type" ("organization_id", "name");
CREATE INDEX IF NOT EXISTS "commission_type_org_idx" ON "commission_type" ("organization_id");

CREATE TABLE IF NOT EXISTS "commission_role" (
  "id" text PRIMARY KEY,
  "type_id" text NOT NULL REFERENCES "commission_type"("id") ON DELETE CASCADE,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "source" text NOT NULL,
  "multi_mode" text NOT NULL DEFAULT 'full_each',
  "is_active" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS "commission_role_type_name_uidx" ON "commission_role" ("type_id", "name");
CREATE INDEX IF NOT EXISTS "commission_role_type_idx" ON "commission_role" ("type_id");

CREATE TABLE IF NOT EXISTS "commission_rate" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "role_id" text NOT NULL REFERENCES "commission_role"("id") ON DELETE CASCADE,
  "category_id" text NOT NULL REFERENCES "document_category"("id") ON DELETE CASCADE,
  "day_type" text NOT NULL,
  "rate" numeric(12,2) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "commission_rate_role_cat_day_uidx" ON "commission_rate" ("role_id", "category_id", "day_type");
CREATE INDEX IF NOT EXISTS "commission_rate_org_idx" ON "commission_rate" ("organization_id");

CREATE TABLE IF NOT EXISTS "member_commission_rate" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "role_id" text NOT NULL REFERENCES "commission_role"("id") ON DELETE CASCADE,
  "category_id" text NOT NULL REFERENCES "document_category"("id") ON DELETE CASCADE,
  "day_type" text NOT NULL,
  "rate" numeric(12,2) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "member_commission_rate_uidx" ON "member_commission_rate" ("user_id", "role_id", "category_id", "day_type");
CREATE INDEX IF NOT EXISTS "member_commission_rate_org_idx" ON "member_commission_rate" ("organization_id");

ALTER TABLE "invoice_allowance" ADD COLUMN IF NOT EXISTS "commission_type_id" text REFERENCES "commission_type"("id") ON DELETE SET NULL;
ALTER TABLE "invoice_allowance" ADD COLUMN IF NOT EXISTS "commission_role_id" text REFERENCES "commission_role"("id") ON DELETE SET NULL;
ALTER TABLE "pay_item" ADD COLUMN IF NOT EXISTS "commission_type_id" text REFERENCES "commission_type"("id") ON DELETE SET NULL;

-- One default type per organization that already has allowance data
INSERT INTO "commission_type" ("id", "organization_id", "name", "sort_order")
SELECT gen_random_uuid()::text, o, 'Case commission', 0
FROM (
  SELECT "organization_id" AS o FROM "category_allowance_rate"
  UNION SELECT "organization_id" FROM "member_allowance_rate"
  UNION SELECT "organization_id" FROM "invoice_allowance"
) x
ON CONFLICT DO NOTHING;

-- Its two roles; the multi-sales-person rule moves from the org profile onto the sales-person role
INSERT INTO "commission_role" ("id", "type_id", "organization_id", "name", "source", "multi_mode", "sort_order")
SELECT gen_random_uuid()::text, t."id", t."organization_id", 'Sales Person', 'sales_person',
       COALESCE(op."allowance_multi_sales_person_mode", 'full_each'), 0
FROM "commission_type" t
LEFT JOIN "organization_profile" op ON op."organization_id" = t."organization_id"
WHERE t."name" = 'Case commission'
ON CONFLICT DO NOTHING;

INSERT INTO "commission_role" ("id", "type_id", "organization_id", "name", "source", "multi_mode", "sort_order")
SELECT gen_random_uuid()::text, t."id", t."organization_id", 'Application Specialist', 'application_specialist', 'full_each', 1
FROM "commission_type" t
WHERE t."name" = 'Case commission'
ON CONFLICT DO NOTHING;

-- Default rates: unpivot the six wide columns (inactive categories are not carried over)
INSERT INTO "commission_rate" ("id", "organization_id", "role_id", "category_id", "day_type", "rate")
SELECT gen_random_uuid()::text, c."organization_id", r."id", c."category_id", v.day, NULLIF(v.rate, '')::numeric
FROM "category_allowance_rate" c
JOIN "commission_type" t ON t."organization_id" = c."organization_id" AND t."name" = 'Case commission'
JOIN "commission_role" r ON r."type_id" = t."id"
CROSS JOIN LATERAL (VALUES
  ('sales_person', 'weekday', c."sales_person_weekday_rate"),
  ('sales_person', 'weekend', c."sales_person_weekend_rate"),
  ('sales_person', 'holiday', c."sales_person_holiday_rate"),
  ('application_specialist', 'weekday', c."app_specialist_weekday_rate"),
  ('application_specialist', 'weekend', c."app_specialist_weekend_rate"),
  ('application_specialist', 'holiday', c."app_specialist_holiday_rate")
) AS v(src, day, rate)
WHERE c."is_active" AND v.src = r."source" AND NULLIF(v.rate, '') IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "member_commission_rate" ("id", "organization_id", "user_id", "role_id", "category_id", "day_type", "rate")
SELECT gen_random_uuid()::text, m."organization_id", m."user_id", r."id", m."category_id", v.day, NULLIF(v.rate, '')::numeric
FROM "member_allowance_rate" m
JOIN "commission_type" t ON t."organization_id" = m."organization_id" AND t."name" = 'Case commission'
JOIN "commission_role" r ON r."type_id" = t."id"
CROSS JOIN LATERAL (VALUES
  ('sales_person', 'weekday', m."sales_person_weekday_rate"),
  ('sales_person', 'weekend', m."sales_person_weekend_rate"),
  ('sales_person', 'holiday', m."sales_person_holiday_rate"),
  ('application_specialist', 'weekday', m."app_specialist_weekday_rate"),
  ('application_specialist', 'weekend', m."app_specialist_weekend_rate"),
  ('application_specialist', 'holiday', m."app_specialist_holiday_rate")
) AS v(src, day, rate)
WHERE m."is_active" AND v.src = r."source" AND NULLIF(v.rate, '') IS NOT NULL
ON CONFLICT DO NOTHING;

-- Existing earnings keep their rows; link them to the type/role and show the role name
UPDATE "invoice_allowance" a
SET "commission_type_id" = t."id", "commission_role_id" = r."id", "role" = r."name"
FROM "commission_type" t
JOIN "commission_role" r ON r."type_id" = t."id"
WHERE t."organization_id" = a."organization_id" AND t."name" = 'Case commission'
  AND r."source" = CASE a."role" WHEN 'sales_person' THEN 'sales_person' ELSE 'application_specialist' END;

DROP INDEX IF EXISTS "invoice_allowance_invoice_user_role_cat_uidx";
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_allowance_invoice_user_role_cat_uidx"
  ON "invoice_allowance" ("invoice_id", "user_id", "commission_role_id", "category_id", "day_type");

-- The payslip case-allowance item pays out the org's default commission type
UPDATE "pay_item" p SET "commission_type_id" = t."id"
FROM "commission_type" t
WHERE t."organization_id" = p."organization_id" AND t."name" = 'Case commission' AND p."calc_type" = 'invoice_allowance';

DROP TABLE IF EXISTS "category_allowance_rate";
DROP TABLE IF EXISTS "member_allowance_rate";
ALTER TABLE "organization_profile" DROP COLUMN IF EXISTS "allowance_multi_sales_person_mode";
