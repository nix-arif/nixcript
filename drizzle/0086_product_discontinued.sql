-- Product lifecycle. A discontinued product stays in the database (old quotations, orders and stock history point at it)
-- but can no longer be put on a new quotation. Existing products are all active.
ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'active';
ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "discontinued_at" timestamp;
ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "discontinued_note" text;
ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "replaced_by_code" text;
