ALTER TABLE "sales_order" ADD COLUMN "so_type" text NOT NULL DEFAULT 'standard';
ALTER TABLE "sales_order" ADD COLUMN "proforma_reason" text;
