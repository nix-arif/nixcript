-- Who may see what we pay suppliers where a page otherwise shows only quantities (the Pending from
-- Supplier page: each line's unit cost from its supplier PO, the pending value and totals).
-- Owners already have every permission; give it to others from Access Control.
INSERT INTO "permission" ("id", "key", "label") VALUES
  (gen_random_uuid()::text, 'purchase-order:view-cost', 'View Supplier Cost Prices (Pending from Supplier)')
ON CONFLICT ("key") DO NOTHING;
