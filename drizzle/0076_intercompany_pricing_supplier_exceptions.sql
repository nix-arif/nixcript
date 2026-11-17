-- A pricing rule can be an exception for one supplier (e.g. "Minaro Surgical" is priced differently from the
-- seller's default), and the PO remembers which supplier it was really for when it is routed to a sibling.
ALTER TABLE "intercompany_pricing_rule" ADD COLUMN IF NOT EXISTS "supplier_name" text;
ALTER TABLE "intercompany_pricing_rule" ADD COLUMN IF NOT EXISTS "supplier_name_normalized" text;
DROP INDEX IF EXISTS "intercompany_pricing_rule_pair_uidx";
CREATE UNIQUE INDEX IF NOT EXISTS "intercompany_pricing_rule_scope_uidx"
  ON "intercompany_pricing_rule" ("seller_organization_id", COALESCE("buyer_organization_id", ''), COALESCE("supplier_name_normalized", ''));
ALTER TABLE "purchase_order" ADD COLUMN IF NOT EXISTS "original_supplier_name" text;
