-- Brand code → Best Medical code conversions (hospital order sheets).
CREATE TABLE "brand_conversion" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "brand_name" text DEFAULT '' NOT NULL,
  "brand_code" text NOT NULL,
  "code_key" text NOT NULL,
  "best_medical_code" text NOT NULL,
  "description" text,
  "uom" text,
  "use_count" integer DEFAULT 1 NOT NULL,
  "last_seen" text,
  "source" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "brand_conversion_uidx" ON "brand_conversion" ("organization_id", "brand_name", "code_key", "best_medical_code");
CREATE INDEX "brand_conversion_key_idx" ON "brand_conversion" ("organization_id", "code_key");
