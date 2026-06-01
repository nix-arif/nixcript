CREATE TABLE "stock_level" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"product_id" text NOT NULL,
	"warehouse_label" text DEFAULT 'Default' NOT NULL,
	"quantity" text DEFAULT '0' NOT NULL,
	"reserved_qty" text DEFAULT '0' NOT NULL,
	"unit_cost" text,
	"reorder_point" text,
	"max_stock" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movement" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"product_id" text NOT NULL,
	"product_code" text NOT NULL,
	"warehouse_label" text DEFAULT 'Default' NOT NULL,
	"warehouse_to" text,
	"movement_type" text NOT NULL,
	"quantity" text NOT NULL,
	"balance_after" text,
	"unit_cost" text,
	"reference_type" text DEFAULT 'MANUAL' NOT NULL,
	"reference_id" text,
	"reference_no" text,
	"notes" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"review_comment" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claim_type" ALTER COLUMN "category" SET DEFAULT 'LOCAL';--> statement-breakpoint
ALTER TABLE "claim_document" ADD COLUMN "line_item_id" text;--> statement-breakpoint
ALTER TABLE "claim_type" ADD COLUMN "hotel_cap_per_night" text;--> statement-breakpoint
ALTER TABLE "claim_type" ADD COLUMN "meal_breakfast_rate" text;--> statement-breakpoint
ALTER TABLE "claim_type" ADD COLUMN "meal_lunch_rate" text;--> statement-breakpoint
ALTER TABLE "claim_type" ADD COLUMN "meal_dinner_rate" text;--> statement-breakpoint
ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_level_product_wh_uidx" ON "stock_level" USING btree ("product_id","organization_id","warehouse_label");--> statement-breakpoint
CREATE INDEX "stock_level_org_idx" ON "stock_level" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "stock_level_wh_idx" ON "stock_level" USING btree ("organization_id","warehouse_label");--> statement-breakpoint
CREATE INDEX "stock_movement_product_idx" ON "stock_movement" USING btree ("product_id","organization_id");--> statement-breakpoint
CREATE INDEX "stock_movement_type_idx" ON "stock_movement" USING btree ("movement_type");--> statement-breakpoint
CREATE INDEX "stock_movement_org_idx" ON "stock_movement" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "stock_movement_created_idx" ON "stock_movement" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "claim_document" ADD CONSTRAINT "claim_document_line_item_id_claim_line_item_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "public"."claim_line_item"("id") ON DELETE set null ON UPDATE no action;