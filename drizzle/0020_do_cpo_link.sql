ALTER TABLE "delivery_order" ADD COLUMN "customer_po_id" text REFERENCES "customer_purchase_order"("id");
ALTER TABLE "delivery_order" ADD COLUMN "customer_po_no" text;
