-- What HR wants on the payslip PDF (YTD columns, employer contributions, ids, bank, footer note)
CREATE TABLE IF NOT EXISTS "payslip_pdf_setting" (
  "organization_id" text PRIMARY KEY REFERENCES "organization"("id") ON DELETE CASCADE,
  "settings" json NOT NULL DEFAULT '{}'::json,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
