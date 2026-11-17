-- Employee performance review: HR templates, review periods, one review per employee per period
-- (self-assessment -> manager review -> HR sign-off). A review keeps its own copy of the criteria, so editing a
-- template later never changes a review that was already opened.
CREATE TABLE IF NOT EXISTS "review_template" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "scale_max" integer DEFAULT 5 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" text NOT NULL REFERENCES "user"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "review_template_org_idx" ON "review_template" ("organization_id");

CREATE TABLE IF NOT EXISTS "review_criterion" (
  "id" text PRIMARY KEY NOT NULL,
  "template_id" text NOT NULL REFERENCES "review_template"("id") ON DELETE CASCADE,
  "section" text DEFAULT '' NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "weight" text DEFAULT '1' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL
);
CREATE INDEX IF NOT EXISTS "review_criterion_template_idx" ON "review_criterion" ("template_id");

CREATE TABLE IF NOT EXISTS "review_period" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "template_id" text REFERENCES "review_template"("id") ON DELETE SET NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "created_by" text NOT NULL REFERENCES "user"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "closed_at" timestamp
);
CREATE INDEX IF NOT EXISTS "review_period_org_idx" ON "review_period" ("organization_id");

CREATE TABLE IF NOT EXISTS "review" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "period_id" text NOT NULL REFERENCES "review_period"("id") ON DELETE CASCADE,
  "employee_user_id" text NOT NULL REFERENCES "user"("id"),
  "reviewer_user_id" text REFERENCES "user"("id"),
  "status" text DEFAULT 'self' NOT NULL,
  "template_name" text NOT NULL,
  "scale_max" integer DEFAULT 5 NOT NULL,
  "criteria" json NOT NULL,
  "self_summary" text,
  "self_submitted_at" timestamp,
  "manager_summary" text,
  "manager_submitted_at" timestamp,
  "signoff_comment" text,
  "signed_off_by" text REFERENCES "user"("id"),
  "signed_off_at" timestamp,
  "return_note" text,
  "final_score" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "review_period_employee_uidx" ON "review" ("period_id", "employee_user_id");
CREATE INDEX IF NOT EXISTS "review_employee_idx" ON "review" ("employee_user_id", "organization_id");
CREATE INDEX IF NOT EXISTS "review_reviewer_idx" ON "review" ("reviewer_user_id", "organization_id");

CREATE TABLE IF NOT EXISTS "review_answer" (
  "id" text PRIMARY KEY NOT NULL,
  "review_id" text NOT NULL REFERENCES "review"("id") ON DELETE CASCADE,
  "criterion_id" text NOT NULL,
  "self_rating" integer,
  "self_comment" text,
  "manager_rating" integer,
  "manager_comment" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "review_answer_uidx" ON "review_answer" ("review_id", "criterion_id");
