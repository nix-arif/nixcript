-- Support one SO linked to multiple Customer POs
ALTER TABLE sales_order ADD COLUMN IF NOT EXISTS customer_po_links json;
