-- Tax relief decided by HR: a catalog of relief types (name, default amount, cap) and
-- per-employee amounts. PCB uses these instead of fixed built-in reliefs.
CREATE TABLE IF NOT EXISTS "tax_relief_type" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "default_amount" numeric(12,2) NOT NULL DEFAULT 0,
  "max_amount" numeric(12,2),
  "applies_to_all" boolean NOT NULL DEFAULT false,
  "link_epf" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "tax_relief_type_org_name_uidx" ON "tax_relief_type" ("organization_id", "name");

CREATE TABLE IF NOT EXISTS "employee_tax_relief" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "relief_type_id" text NOT NULL REFERENCES "tax_relief_type"("id") ON DELETE CASCADE,
  "amount" numeric(12,2) NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS "employee_tax_relief_uidx" ON "employee_tax_relief" ("user_id", "relief_type_id");
CREATE INDEX IF NOT EXISTS "employee_tax_relief_org_idx" ON "employee_tax_relief" ("organization_id");
