-- Intercompany pricing: how a PO to a sibling organization is priced.
-- purchase_order keeps the method used; the other two tables hold the default rules and the price list.
ALTER TABLE "purchase_order" ADD COLUMN IF NOT EXISTS "pricing_method" text;
ALTER TABLE "purchase_order" ADD COLUMN IF NOT EXISTS "pricing_margin_pct" text;

CREATE TABLE IF NOT EXISTS "intercompany_pricing_rule" (
  "id" text PRIMARY KEY NOT NULL,
  "seller_organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "buyer_organization_id" text REFERENCES "organization"("id") ON DELETE CASCADE,
  "method" text NOT NULL,
  "margin_pct" text,
  "created_by" text NOT NULL REFERENCES "user"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "intercompany_pricing_rule_pair_uidx"
  ON "intercompany_pricing_rule" ("seller_organization_id", COALESCE("buyer_organization_id", ''));

CREATE TABLE IF NOT EXISTS "intercompany_price" (
  "id" text PRIMARY KEY NOT NULL,
  "seller_organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "product_code" text NOT NULL,
  "product_code_normalized" text NOT NULL,
  "unit_price" text NOT NULL,
  "currency" text DEFAULT 'MYR' NOT NULL,
  "created_by" text NOT NULL REFERENCES "user"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "intercompany_price_seller_code_uidx"
  ON "intercompany_price" ("seller_organization_id", "product_code_normalized");
