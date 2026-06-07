-- Support one CPO referencing multiple quotations (same customer)
ALTER TABLE customer_purchase_order ADD COLUMN IF NOT EXISTS quotation_links json;
