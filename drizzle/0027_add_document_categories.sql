-- Add document_category table
CREATE TABLE IF NOT EXISTS "document_category" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "color" text DEFAULT '#6366f1',
  "is_default" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "document_category_org_idx" ON "document_category" ("organization_id");

-- Add category_ids JSON column to quotation (safe: new column with default)
ALTER TABLE "quotation" ADD COLUMN IF NOT EXISTS "category_ids" json NOT NULL DEFAULT '[]'::json;

-- Add category_ids JSON column to invoice (safe: new column with default)
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "category_ids" json NOT NULL DEFAULT '[]'::json;
