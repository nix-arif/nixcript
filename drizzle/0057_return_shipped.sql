-- Track when a rejected unit is physically handed back to the supplier,
-- separately from how the return is eventually settled.
ALTER TABLE "goods_receipt_item" ADD COLUMN "return_shipped_at" timestamp;
ALTER TABLE "goods_receipt_item" ADD COLUMN "return_shipped_by" text REFERENCES "user"("id");
ALTER TABLE "goods_receipt_item" ADD COLUMN "return_ship_ref" text;
