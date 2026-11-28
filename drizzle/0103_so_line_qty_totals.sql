-- Sales order lines in a set now hold the TOTAL quantity and amounts (they held one set's): × the set's
-- count. set_qty stays, to show "2 sets". Order totals (subtotal, grand total) are already for all sets,
-- so they don't change. Run once, together with the release that stops multiplying by set_qty: the
-- marker row makes a second run do nothing.
CREATE TABLE IF NOT EXISTS "data_migration" ("name" text PRIMARY KEY NOT NULL, "applied_at" timestamp DEFAULT now() NOT NULL);

DO $$
BEGIN
  INSERT INTO "data_migration" ("name") VALUES ('0103_so_line_qty_totals') ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN; END IF;

  UPDATE "sales_order_item" SET
    "qty"          = trim_scale(round("qty"::numeric * "set_qty"::numeric, 4))::text,
    "total_price"  = round(coalesce(nullif("total_price", ''), '0')::numeric * "set_qty"::numeric, 2)::text,
    "discount_amt" = round(coalesce(nullif("discount_amt", ''), '0')::numeric * "set_qty"::numeric, 2)::text
  WHERE coalesce("set_group_id", '') <> ''
    AND CASE WHEN "set_qty" ~ '^\s*\d+(\.\d+)?\s*$' THEN "set_qty"::numeric > 0 AND "set_qty"::numeric <> 1 ELSE false END;
END $$;
