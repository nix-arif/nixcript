-- Per-set price on quotation items: when set, the set is priced as a whole and
-- the item unit prices inside it are ignored. Identical for every item of a set.
ALTER TABLE "quotation_item" ADD COLUMN "set_price" text;
