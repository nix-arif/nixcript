-- Categories on every stage of an order: the customer PO, sales order, PR and supplier PO carry the
-- categories of the document they came from (the quotation's, down the chain to the DO and invoice).
ALTER TABLE "customer_purchase_order" ADD COLUMN IF NOT EXISTS "category_ids" json DEFAULT '[]'::json NOT NULL;
ALTER TABLE "sales_order" ADD COLUMN IF NOT EXISTS "category_ids" json DEFAULT '[]'::json NOT NULL;
ALTER TABLE "purchase_requisition" ADD COLUMN IF NOT EXISTS "category_ids" json DEFAULT '[]'::json NOT NULL;
ALTER TABLE "purchase_order" ADD COLUMN IF NOT EXISTS "category_ids" json DEFAULT '[]'::json NOT NULL;
