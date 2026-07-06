-- quotation: add gov_batch_id to link all quotations from the same government batch
ALTER TABLE "quotation" ADD COLUMN IF NOT EXISTS "gov_batch_id" text;
