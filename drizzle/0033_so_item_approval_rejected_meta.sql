ALTER TABLE "sales_order_item"
  ADD COLUMN "approval_rejected_by" text,
  ADD COLUMN "approval_rejected_at" timestamp;
