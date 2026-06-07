-- Tag each SO line item with the Customer PO it came from,
-- so multi-customer SOs can be queried correctly per customer.
ALTER TABLE sales_order_item ADD COLUMN IF NOT EXISTS source_customer_po_id text;
ALTER TABLE sales_order_item ADD COLUMN IF NOT EXISTS source_customer_po_no text;
