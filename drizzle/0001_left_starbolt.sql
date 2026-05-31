CREATE TABLE "claim_application" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"application_no" text NOT NULL,
	"user_id" text NOT NULL,
	"claim_type_id" text NOT NULL,
	"claim_type_name" text NOT NULL,
	"claim_type_code" text NOT NULL,
	"claim_date" text NOT NULL,
	"description" text NOT NULL,
	"unit_type" text DEFAULT 'AMOUNT' NOT NULL,
	"quantity" text,
	"rate_per_unit" text,
	"amount" text DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"review_comment" text,
	"cancelled_by" text,
	"cancelled_at" timestamp,
	"cancel_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_document" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"file_name" text NOT NULL,
	"file_key" text NOT NULL,
	"file_size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_entertainment_detail" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"event_date" text NOT NULL,
	"restaurant_name" text NOT NULL,
	"customer_name" text NOT NULL,
	"department_organization" text NOT NULL,
	"purpose" text NOT NULL,
	"amount" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "claim_entertainment_detail_application_id_unique" UNIQUE("application_id")
);
--> statement-breakpoint
CREATE TABLE "claim_line_item" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"category" text NOT NULL,
	"line_date" text NOT NULL,
	"description" text,
	"from_location" text,
	"to_location" text,
	"distance_km" text,
	"rate_per_unit" text,
	"venue" text,
	"destination" text,
	"currency" text,
	"amount_foreign" text,
	"exchange_rate" text,
	"amount_myr" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_type" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"category" text DEFAULT 'OTHER' NOT NULL,
	"unit_type" text DEFAULT 'AMOUNT' NOT NULL,
	"rate_per_unit" text,
	"requires_receipt" boolean DEFAULT true NOT NULL,
	"max_amount_per_claim" text,
	"max_amount_per_year" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_application" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"application_no" text NOT NULL,
	"user_id" text NOT NULL,
	"leave_type_id" text NOT NULL,
	"leave_type_name" text NOT NULL,
	"leave_type_code" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"total_days" text NOT NULL,
	"is_half_day" boolean DEFAULT false NOT NULL,
	"half_day_period" text,
	"reason" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"review_comment" text,
	"cancelled_by" text,
	"cancelled_at" timestamp,
	"cancel_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_document" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"file_name" text NOT NULL,
	"file_key" text NOT NULL,
	"file_size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_entitlement" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"leave_type_id" text NOT NULL,
	"year" integer NOT NULL,
	"entitled_days" text DEFAULT '0' NOT NULL,
	"used_days" text DEFAULT '0' NOT NULL,
	"pending_days" text DEFAULT '0' NOT NULL,
	"carry_forward_days" text DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_type" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"is_paid" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"requires_document" boolean DEFAULT false NOT NULL,
	"allow_half_day" boolean DEFAULT true NOT NULL,
	"max_days_per_application" integer,
	"carry_forward_enabled" boolean DEFAULT false NOT NULL,
	"max_carry_forward" integer,
	"entitlement_rules" json DEFAULT '[]'::json NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_account" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"subtype" text,
	"normal_balance" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_document" (
	"id" text PRIMARY KEY NOT NULL,
	"entry_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"file_name" text NOT NULL,
	"file_key" text NOT NULL,
	"file_size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"entry_no" text NOT NULL,
	"date" text NOT NULL,
	"description" text NOT NULL,
	"transaction_type" text NOT NULL,
	"reference_type" text DEFAULT 'NONE' NOT NULL,
	"reference_id" text,
	"reference_no" text,
	"stakeholder_type" text DEFAULT 'NONE' NOT NULL,
	"stakeholder_id" text,
	"stakeholder_name" text,
	"total_amount" text DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"void_reason" text,
	"posted_at" timestamp,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_line" (
	"id" text PRIMARY KEY NOT NULL,
	"entry_id" text NOT NULL,
	"account_id" text NOT NULL,
	"account_code" text NOT NULL,
	"account_name" text NOT NULL,
	"debit" text DEFAULT '0' NOT NULL,
	"credit" text DEFAULT '0' NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_numbering_setting" ADD COLUMN "number_format" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "claim_application" ADD CONSTRAINT "claim_application_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_application" ADD CONSTRAINT "claim_application_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_application" ADD CONSTRAINT "claim_application_claim_type_id_claim_type_id_fk" FOREIGN KEY ("claim_type_id") REFERENCES "public"."claim_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_application" ADD CONSTRAINT "claim_application_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_application" ADD CONSTRAINT "claim_application_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_document" ADD CONSTRAINT "claim_document_application_id_claim_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."claim_application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_document" ADD CONSTRAINT "claim_document_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_document" ADD CONSTRAINT "claim_document_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_entertainment_detail" ADD CONSTRAINT "claim_entertainment_detail_application_id_claim_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."claim_application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_line_item" ADD CONSTRAINT "claim_line_item_application_id_claim_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."claim_application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_type" ADD CONSTRAINT "claim_type_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_application" ADD CONSTRAINT "leave_application_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_application" ADD CONSTRAINT "leave_application_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_application" ADD CONSTRAINT "leave_application_leave_type_id_leave_type_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_application" ADD CONSTRAINT "leave_application_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_application" ADD CONSTRAINT "leave_application_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_document" ADD CONSTRAINT "leave_document_application_id_leave_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."leave_application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_document" ADD CONSTRAINT "leave_document_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_document" ADD CONSTRAINT "leave_document_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_entitlement" ADD CONSTRAINT "leave_entitlement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_entitlement" ADD CONSTRAINT "leave_entitlement_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_entitlement" ADD CONSTRAINT "leave_entitlement_leave_type_id_leave_type_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_type" ADD CONSTRAINT "leave_type_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_account" ADD CONSTRAINT "ledger_account_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_document" ADD CONSTRAINT "ledger_document_entry_id_ledger_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."ledger_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_document" ADD CONSTRAINT "ledger_document_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_document" ADD CONSTRAINT "ledger_document_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_line" ADD CONSTRAINT "ledger_line_entry_id_ledger_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."ledger_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_line" ADD CONSTRAINT "ledger_line_account_id_ledger_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claim_application_no_org_uidx" ON "claim_application" USING btree ("organization_id","application_no");--> statement-breakpoint
CREATE INDEX "claim_application_user_idx" ON "claim_application" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX "claim_application_status_idx" ON "claim_application" USING btree ("status","organization_id");--> statement-breakpoint
CREATE INDEX "claim_document_application_idx" ON "claim_document" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "claim_document_org_idx" ON "claim_document" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "claim_line_item_app_idx" ON "claim_line_item" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "claim_line_item_org_idx" ON "claim_line_item" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_type_org_code_uidx" ON "claim_type" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "claim_type_org_idx" ON "claim_type" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_application_no_org_uidx" ON "leave_application" USING btree ("organization_id","application_no");--> statement-breakpoint
CREATE INDEX "leave_application_user_idx" ON "leave_application" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX "leave_application_status_idx" ON "leave_application" USING btree ("status","organization_id");--> statement-breakpoint
CREATE INDEX "leave_application_date_idx" ON "leave_application" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX "leave_document_application_idx" ON "leave_document" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "leave_document_org_idx" ON "leave_document" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_entitlement_unique" ON "leave_entitlement" USING btree ("organization_id","user_id","leave_type_id","year");--> statement-breakpoint
CREATE INDEX "leave_entitlement_user_idx" ON "leave_entitlement" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_type_org_code_uidx" ON "leave_type" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "leave_type_org_idx" ON "leave_type" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_account_org_code_uidx" ON "ledger_account" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "ledger_account_org_idx" ON "ledger_account" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ledger_document_entry_idx" ON "ledger_document" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "ledger_document_org_idx" ON "ledger_document" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entry_no_org_uidx" ON "ledger_entry" USING btree ("organization_id","entry_no");--> statement-breakpoint
CREATE INDEX "ledger_entry_org_idx" ON "ledger_entry" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ledger_entry_date_idx" ON "ledger_entry" USING btree ("date");--> statement-breakpoint
CREATE INDEX "ledger_entry_type_idx" ON "ledger_entry" USING btree ("transaction_type");--> statement-breakpoint
CREATE INDEX "ledger_line_entry_idx" ON "ledger_line" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "ledger_line_account_idx" ON "ledger_line" USING btree ("account_id");