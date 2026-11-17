-- A lot number is just the number (01-260005-052-24). The first version stored it with a "LOT-" prefix, so drop it
-- from the lots already issued. Safe to run again: only values that still start with "LOT-" are touched.
UPDATE "packing_list_item" SET "lot_no" = substr("lot_no", 5) WHERE "lot_no" LIKE 'LOT-%';
