-- Store line items on customer PO (imported from linked quotation, editable)
ALTER TABLE customer_purchase_order ADD COLUMN IF NOT EXISTS items json;
