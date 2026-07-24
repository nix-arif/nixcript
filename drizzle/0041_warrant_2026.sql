CREATE TABLE "warrant_2026_row" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "row_index" integer NOT NULL DEFAULT 0,
  "warran_no" text,
  "date" text,
  "ministry" text,
  "description" text,
  "amount" text,
  "status" text,
  "remarks" text,
  "updated_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "updated_by_name" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "warrant_2026_org_idx" ON "warrant_2026_row" ("organization_id");
CREATE INDEX "warrant_2026_row_order_idx" ON "warrant_2026_row" ("organization_id", "row_index");
