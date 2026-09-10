-- Configurable per-category allowance rates for the sales person / application
-- specialist on a case invoice (weekday vs weekend), plus the generated,
-- itemized statement rows those rates produce. See server/invoice-allowance.ts.
CREATE TABLE "category_allowance_rate" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "category_id" text NOT NULL REFERENCES "document_category"("id") ON DELETE CASCADE,
  "sales_person_weekday_rate" text,
  "sales_person_weekend_rate" text,
  "sales_person_holiday_rate" text,
  "app_specialist_weekday_rate" text,
  "app_specialist_weekend_rate" text,
  "app_specialist_holiday_rate" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "category_allowance_rate_org_cat_uidx" ON "category_allowance_rate" ("organization_id", "category_id");
CREATE INDEX "category_allowance_rate_org_idx" ON "category_allowance_rate" ("organization_id");

-- Org-defined public holiday calendar — a case on one of these dates earns
-- the (optional, higher) holiday rate instead of weekday/weekend, even if
-- the date also falls on a weekend.
CREATE TABLE "public_holiday" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "date" text NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "public_holiday_org_date_uidx" ON "public_holiday" ("organization_id", "date");
CREATE INDEX "public_holiday_org_idx" ON "public_holiday" ("organization_id");

CREATE TABLE "invoice_allowance" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "invoice_id" text NOT NULL REFERENCES "invoice"("id") ON DELETE CASCADE,
  "invoice_no" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id"),
  "user_name" text NOT NULL,
  "role" text NOT NULL,
  "category_id" text REFERENCES "document_category"("id") ON DELETE SET NULL,
  "category_name" text NOT NULL,
  "day_type" text NOT NULL,
  "rate" text NOT NULL,
  "amount" text NOT NULL,
  "case_date" timestamp,
  "status" text DEFAULT 'pending' NOT NULL,
  "paid_at" timestamp,
  "paid_by" text REFERENCES "user"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "invoice_allowance_invoice_user_role_cat_uidx" ON "invoice_allowance" ("invoice_id", "user_id", "role", "category_id", "day_type");
CREATE INDEX "invoice_allowance_org_idx" ON "invoice_allowance" ("organization_id");
CREATE INDEX "invoice_allowance_invoice_idx" ON "invoice_allowance" ("invoice_id");
CREATE INDEX "invoice_allowance_user_idx" ON "invoice_allowance" ("user_id");

-- How the rate is shared when an invoice lists more than one sales person.
ALTER TABLE "organization_profile" ADD COLUMN "allowance_multi_sales_person_mode" text DEFAULT 'full_each';
