CREATE TABLE "staff_stock_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"product_id" text NOT NULL,
	"max_qty" text NOT NULL,
	"set_by" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_request" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"product_id" text NOT NULL,
	"product_code" text NOT NULL,
	"warehouse_from" text DEFAULT 'Default' NOT NULL,
	"qty" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_by" text,
	"approved_qty" text,
	"approved_at" timestamp,
	"approved_notes" text,
	"fulfilled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_stock_limit" ADD CONSTRAINT "staff_stock_limit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_stock_limit" ADD CONSTRAINT "staff_stock_limit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_stock_limit" ADD CONSTRAINT "staff_stock_limit_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_stock_limit" ADD CONSTRAINT "staff_stock_limit_set_by_user_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_request" ADD CONSTRAINT "stock_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_request" ADD CONSTRAINT "stock_request_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_request" ADD CONSTRAINT "stock_request_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_request" ADD CONSTRAINT "stock_request_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_stock_limit_uidx" ON "staff_stock_limit" USING btree ("organization_id","user_id","product_id");--> statement-breakpoint
CREATE INDEX "staff_stock_limit_org_idx" ON "staff_stock_limit" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "stock_request_org_idx" ON "stock_request" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "stock_request_user_idx" ON "stock_request" USING btree ("requested_by","organization_id");--> statement-breakpoint
CREATE INDEX "stock_request_status_idx" ON "stock_request" USING btree ("status","organization_id");