-- Drop old fixed-column warrant table (created in 0041, not yet in production)
DROP TABLE IF EXISTS "warrant_2026_row";

-- Column config per org (owner sets this on first import)
CREATE TABLE "warrant_2026_config" (
  "organization_id" text PRIMARY KEY REFERENCES "organization"("id") ON DELETE CASCADE,
  "columns"         json NOT NULL DEFAULT '[]',
  "updated_at"      timestamp DEFAULT now() NOT NULL
);

-- Flexible rows: cells is a JSON array of string values, one per column index
CREATE TABLE "warrant_2026_row" (
  "id"               text PRIMARY KEY NOT NULL,
  "organization_id"  text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "row_index"        integer NOT NULL DEFAULT 0,
  "cells"            json NOT NULL DEFAULT '[]',
  "updated_by"       text REFERENCES "user"("id") ON DELETE SET NULL,
  "updated_by_name"  text,
  "created_at"       timestamp DEFAULT now() NOT NULL,
  "updated_at"       timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "warrant_2026_org_idx"       ON "warrant_2026_row" ("organization_id");
CREATE INDEX "warrant_2026_row_order_idx" ON "warrant_2026_row" ("organization_id", "row_index");
