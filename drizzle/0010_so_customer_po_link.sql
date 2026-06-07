-- Link SO → Customer PO (the missing direction)
ALTER TABLE sales_order ADD COLUMN IF NOT EXISTS customer_po_id text REFERENCES customer_purchase_order(id);
ALTER TABLE sales_order ADD COLUMN IF NOT EXISTS customer_po_no text;
