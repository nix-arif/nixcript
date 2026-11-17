-- A supplier's handling organization can change over time: each rule has the date it takes effect (null = from the
-- beginning). The rule with the latest effective_from on or before the PO / PR date is the one that applies.
ALTER TABLE "restricted_supplier" ADD COLUMN IF NOT EXISTS "effective_from" date;
DROP INDEX IF EXISTS "restricted_supplier_owner_name_uidx";
CREATE UNIQUE INDEX IF NOT EXISTS "restricted_supplier_owner_name_from_uidx"
  ON "restricted_supplier" ("owner_user_id", "supplier_name_normalized", COALESCE("effective_from", DATE '0001-01-01'));
