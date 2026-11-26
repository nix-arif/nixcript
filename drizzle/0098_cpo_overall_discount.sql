-- Customer PO overall discount: carried from the quotation(s) the CPO was made from, so the
-- Sales Order made from the CPO keeps it. Either a % of the items' total (overall_discount_pct > 0)
-- or a fixed RM amount (overall_discount_amt, with pct 0). A fixed quotation discount is shared out by
-- the part of the quotation the CPO orders. The user can change or remove it on the CPO.
-- Only adds nullable columns; safe to run again.
ALTER TABLE "customer_purchase_order" ADD COLUMN IF NOT EXISTS "overall_discount_pct" text;
ALTER TABLE "customer_purchase_order" ADD COLUMN IF NOT EXISTS "overall_discount_amt" text;
