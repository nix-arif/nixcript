-- How a returned-to-supplier line actually got settled, and (when the
-- settlement was a replacement shipment) which packing list carried it.
-- Repair stays a plain status flag — it has no external counterparty, so
-- "resolved" already fully describes it.
ALTER TABLE "goods_receipt_item" ADD COLUMN "return_resolution_type" text;
ALTER TABLE "goods_receipt_item" ADD COLUMN "return_resolution_packing_list_id" text REFERENCES "packing_list"("id");
ALTER TABLE "goods_receipt_item" ADD COLUMN "return_resolution_notes" text;
