-- 0044 added return_resolution_packing_list_id without an ON DELETE clause,
-- which defaults to NO ACTION — meaning deleting a packing list that was
-- ever cited as a "replacement" resolution on some unrelated return became
-- impossible, surfacing a raw DB error to the user. This is an audit
-- pointer, not a hard dependency, so it should clear on delete instead of
-- blocking it.
ALTER TABLE "goods_receipt_item" DROP CONSTRAINT IF EXISTS "goods_receipt_item_return_resolution_packing_list_id_fkey";
ALTER TABLE "goods_receipt_item" ADD CONSTRAINT "goods_receipt_item_return_resolution_packing_list_id_fkey"
  FOREIGN KEY ("return_resolution_packing_list_id") REFERENCES "packing_list"("id") ON DELETE SET NULL;
