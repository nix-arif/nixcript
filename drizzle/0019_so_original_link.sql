ALTER TABLE "sales_order" ADD COLUMN "original_so_id" text REFERENCES "sales_order"("id");
ALTER TABLE "sales_order" ADD COLUMN "original_so_no" text;
