-- Item-level customer trace: which customer PO / customer / customer organization each line is for,
-- carried from the Sales Order item through PR, Supplier PO, packing list, DO and invoice — so an SO that
-- combines several CPOs doesn't lose track of whose line is whose. Values are copied by
-- lib/trace/item-customer.ts (on save, and once for existing data: scripts/backfill-item-customers.ts).
-- Only adds nullable columns; safe to run again.

-- DO and invoice lines: the full set (they had none — only one CPO / customer on the header)
ALTER TABLE "delivery_order_item" ADD COLUMN IF NOT EXISTS "source_customer_po_id" text;
ALTER TABLE "delivery_order_item" ADD COLUMN IF NOT EXISTS "source_customer_po_no" text;
ALTER TABLE "delivery_order_item" ADD COLUMN IF NOT EXISTS "customer_id" text;
ALTER TABLE "delivery_order_item" ADD COLUMN IF NOT EXISTS "customer_organization_id" text;
ALTER TABLE "delivery_order_item" ADD COLUMN IF NOT EXISTS "customer_name" text;
ALTER TABLE "delivery_order_item" ADD COLUMN IF NOT EXISTS "customer_organization" text;

ALTER TABLE "invoice_item" ADD COLUMN IF NOT EXISTS "source_customer_po_id" text;
ALTER TABLE "invoice_item" ADD COLUMN IF NOT EXISTS "source_customer_po_no" text;
ALTER TABLE "invoice_item" ADD COLUMN IF NOT EXISTS "customer_id" text;
ALTER TABLE "invoice_item" ADD COLUMN IF NOT EXISTS "customer_organization_id" text;
ALTER TABLE "invoice_item" ADD COLUMN IF NOT EXISTS "customer_name" text;
ALTER TABLE "invoice_item" ADD COLUMN IF NOT EXISTS "customer_organization" text;

-- PR lines kept the CPO number and names as text only: add the ids behind them
ALTER TABLE "purchase_requisition_item" ADD COLUMN IF NOT EXISTS "source_customer_po_id" text;
ALTER TABLE "purchase_requisition_item" ADD COLUMN IF NOT EXISTS "customer_id" text;
ALTER TABLE "purchase_requisition_item" ADD COLUMN IF NOT EXISTS "customer_organization_id" text;

-- Supplier PO and packing-list lines kept the CPO number only: add its id
ALTER TABLE "purchase_order_item" ADD COLUMN IF NOT EXISTS "source_customer_po_id" text;
ALTER TABLE "packing_list_item" ADD COLUMN IF NOT EXISTS "source_customer_po_id" text;
