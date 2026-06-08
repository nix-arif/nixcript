ALTER TABLE "sales_order" ADD COLUMN "stock_reservation_status" text;
ALTER TABLE "sales_order" ADD COLUMN "stock_reserved_at" timestamp;
ALTER TABLE "sales_order" ADD COLUMN "stock_reserved_by" text REFERENCES "user"("id");
