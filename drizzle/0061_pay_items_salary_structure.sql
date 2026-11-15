-- Pay items (HR-defined earning/deduction types with statutory flags) and
-- per-employee salary structures (basic + recurring pay items).
DROP TABLE IF EXISTS "payslip_allowance_type";

CREATE TABLE IF NOT EXISTS "pay_item" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'earning',
  "statutory" boolean NOT NULL DEFAULT false,
  "taxable" boolean NOT NULL DEFAULT false,
  "recurring" boolean NOT NULL DEFAULT true,
  "is_active" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "pay_item_org_name_uidx" ON "pay_item" ("organization_id", "name");
CREATE INDEX IF NOT EXISTS "pay_item_org_idx" ON "pay_item" ("organization_id");

CREATE TABLE IF NOT EXISTS "salary_structure" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "basic_salary" text NOT NULL DEFAULT '0',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "salary_structure_org_user_uidx" ON "salary_structure" ("organization_id", "user_id");

CREATE TABLE IF NOT EXISTS "salary_structure_item" (
  "id" text PRIMARY KEY,
  "structure_id" text NOT NULL REFERENCES "salary_structure"("id") ON DELETE CASCADE,
  "pay_item_id" text NOT NULL REFERENCES "pay_item"("id") ON DELETE CASCADE,
  "amount" text NOT NULL DEFAULT '0'
);
CREATE UNIQUE INDEX IF NOT EXISTS "salary_structure_item_uidx" ON "salary_structure_item" ("structure_id", "pay_item_id");
