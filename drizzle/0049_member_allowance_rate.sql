-- Per-member override of category_allowance_rate — lets specific individuals
-- be paid a different rate than the org default for a given category. When a
-- row exists here for the earner, it replaces the category default for that
-- role/day-type; a null field falls back to the category default (unlike
-- category_allowance_rate, where null means "earns nothing" — this table
-- only ever narrows down which rate applies, never disables an allowance).
-- See server/invoice-allowance.ts.
CREATE TABLE "member_allowance_rate" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
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
CREATE UNIQUE INDEX "member_allowance_rate_org_user_cat_uidx" ON "member_allowance_rate" ("organization_id", "user_id", "category_id");
CREATE INDEX "member_allowance_rate_org_idx" ON "member_allowance_rate" ("organization_id");
CREATE INDEX "member_allowance_rate_user_idx" ON "member_allowance_rate" ("user_id");
