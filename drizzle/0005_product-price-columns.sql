-- Rename unit_price → selling_unit_price (values preserved)
ALTER TABLE "product" RENAME COLUMN "unit_price" TO "selling_unit_price";--> statement-breakpoint

-- Add selling_price_currency with default MYR for all rows
ALTER TABLE "product" ADD COLUMN "selling_price_currency" text NOT NULL DEFAULT 'MYR';--> statement-breakpoint

-- Add cost columns (nullable, existing rows are NULL)
ALTER TABLE "product" ADD COLUMN "cost_unit_price" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "cost_selling_price" text;
