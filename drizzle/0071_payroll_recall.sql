-- Recalling a published payroll period back to draft: who, when, why (kept as a log)
CREATE TABLE IF NOT EXISTS "payroll_period_recall" (
  "id" text PRIMARY KEY,
  "period_id" text NOT NULL REFERENCES "payroll_period"("id") ON DELETE CASCADE,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "recalled_by" text NOT NULL REFERENCES "user"("id"),
  "reason" text NOT NULL,
  "payslip_count" integer NOT NULL DEFAULT 0,
  "recalled_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "payroll_period_recall_period_idx" ON "payroll_period_recall" ("period_id");
