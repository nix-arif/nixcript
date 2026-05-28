CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_commission" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"claimed_by" text,
	"claimed_by_user_id" text,
	"docs" text,
	"attend_amount" text DEFAULT '0',
	"surgeon_amount" text DEFAULT '0',
	"surgeon_paid_at" timestamp,
	"incentive" text DEFAULT '0',
	"actual_amount" text DEFAULT '0',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "case_commission_invoice_id_unique" UNIQUE("invoice_id")
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"title" text,
	"name" text NOT NULL,
	"organization_name" text,
	"organization_address" text,
	"position" text,
	"department" text,
	"contact_no" text,
	"email" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_company" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"organization_name" text,
	"organization_address" text,
	"position" text,
	"department" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_purchase_order" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"customer_po_no" text NOT NULL,
	"customer_id" text,
	"customer_snapshot" json,
	"quotation_id" text,
	"quotation_no" text,
	"sales_order_id" text,
	"sales_order_no" text,
	"amount" text DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'MYR' NOT NULL,
	"document_key" text,
	"notes" text,
	"received_date" timestamp,
	"status" text DEFAULT 'received' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_order" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"do_no" text NOT NULL,
	"sales_order_id" text,
	"sales_order_no" text,
	"customer_id" text,
	"customer_snapshot" json,
	"delivered_to" text,
	"delivery_address" text,
	"delivery_date" timestamp,
	"notes" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_order_counter" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"year" integer NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_order_counter_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "delivery_order_item" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_order_id" text NOT NULL,
	"row_no" integer NOT NULL,
	"product_code" text,
	"description" text,
	"qty" text DEFAULT '1' NOT NULL,
	"uom" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "department" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_numbering_setting" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"document_type" text NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"doc_code" text NOT NULL,
	"separator" text DEFAULT '-' NOT NULL,
	"include_year" integer DEFAULT 1 NOT NULL,
	"padding_length" integer DEFAULT 4 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"department_id" text,
	"department_role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL,
	"team_id" text
);
--> statement-breakpoint
CREATE TABLE "invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"invoice_no" text NOT NULL,
	"invoice_date" timestamp DEFAULT now() NOT NULL,
	"customer_id" text,
	"customer_snapshot" json,
	"customer_po_id" text,
	"customer_po_no" text,
	"quotation_id" text,
	"quotation_no" text,
	"sales_order_id" text,
	"sales_order_no" text,
	"delivery_order_id" text,
	"delivery_order_no" text,
	"purchase_order_id" text,
	"supplier_id" text,
	"supplier_snapshot" json,
	"sales_person_id" text,
	"sales_person_name" text,
	"application_specialist_id" text,
	"application_specialist_name" text,
	"subtotal" text DEFAULT '0' NOT NULL,
	"overall_discount_pct" text DEFAULT '0',
	"overall_discount_amt" text DEFAULT '0',
	"sst" text DEFAULT '0',
	"sst_pct" text DEFAULT '0',
	"grand_total" text DEFAULT '0' NOT NULL,
	"cost_total" text DEFAULT '0',
	"expenses_total" text DEFAULT '0',
	"profit" text DEFAULT '0',
	"case_date" timestamp,
	"case_type" text,
	"case_time" text,
	"mrn_no" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"payment_terms" text,
	"due_date" timestamp,
	"paid_at" timestamp,
	"paid_amount" text,
	"payment_ref" text,
	"soa_verified" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_counter" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"year" integer NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_counter_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "invoice_expense" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"description" text NOT NULL,
	"category" text DEFAULT 'other',
	"amount" text DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_item" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"row_no" integer NOT NULL,
	"product_id" text,
	"product_code" text,
	"description" text,
	"qty" text DEFAULT '1' NOT NULL,
	"uom" text,
	"unit_price" text DEFAULT '0',
	"discount_pct" text DEFAULT '0',
	"discount_amt" text DEFAULT '0',
	"total_price" text DEFAULT '0',
	"cost_unit_price" text DEFAULT '0',
	"cost_total" text DEFAULT '0',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"department_id" text,
	"created_at" timestamp NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" text
);
--> statement-breakpoint
CREATE TABLE "member_department" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"department_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"is_read" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "organization_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"old_ssm_no" text,
	"new_ssm_no" text,
	"ssm_cert_url" text,
	"company_name" text,
	"tax_no" text,
	"tax_cert_url" text,
	"company_address" text,
	"warehouse_addresses" json DEFAULT '[]'::json,
	"mof_no" text,
	"mof_validity" timestamp,
	"mof_cert_url" text,
	"pkk_no" text,
	"pkk_cert_url" text,
	"logo_key" text,
	"brand_color" text,
	"slate_text_color" text,
	"slate_heading_color" text,
	"slate_info_font_size" text,
	"template_style" text DEFAULT 'corporate',
	"pdf_template" text DEFAULT 'affirma',
	"title_position" text DEFAULT 'stamp',
	"table_font_size" text DEFAULT 'normal',
	"header_layout" text DEFAULT 'standard',
	"org_name_size" text DEFAULT 'medium',
	"org_name_bold" integer DEFAULT 1,
	"org_name_uppercase" integer DEFAULT 0,
	"org_info_side" text DEFAULT 'left',
	"quotation_label_size" text DEFAULT 'normal',
	"quotation_label_bold" integer DEFAULT 1,
	"quotation_label_uppercase" integer DEFAULT 1,
	"quotation_label_align" text DEFAULT 'right',
	"table_row_style" text DEFAULT 'default',
	"show_code_column" integer DEFAULT 1,
	"quotation_no_format" text DEFAULT 'A',
	"phone" text,
	"email" text,
	"website" text,
	"mda_establishment_no" text,
	"mda_establishment_validity" timestamp,
	"mda_cert_url" text,
	"attention_name_size" text DEFAULT 'medium',
	"attention_name_bold" integer DEFAULT 1,
	"detail_font_size" text DEFAULT 'normal',
	"detail_font_bold" integer DEFAULT 0,
	"detail_alignment" text DEFAULT 'right',
	"bank_statement_url" text,
	"lampiran12_url" text,
	"lampiran13_url" text,
	"banking_info" json DEFAULT '[]'::json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_profile_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "organization_role" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"role" text NOT NULL,
	"permission" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_period" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"month" integer NOT NULL,
	"year" integer NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payslip" (
	"id" text PRIMARY KEY NOT NULL,
	"period_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"employee_name" text NOT NULL,
	"ic_number" text,
	"job_title" text,
	"department" text,
	"employment_type" text,
	"bank_name" text,
	"bank_account_no" text,
	"bank_account_holder" text,
	"basic_salary" text NOT NULL,
	"bonus" text DEFAULT '0',
	"overtime_pay" text DEFAULT '0',
	"allowances" json DEFAULT '[]'::json,
	"epf_employee" text DEFAULT '0',
	"epf_employer" text DEFAULT '0',
	"socso_employee" text DEFAULT '0',
	"socso_employer" text DEFAULT '0',
	"eis_employee" text DEFAULT '0',
	"eis_employer" text DEFAULT '0',
	"lhdn" text DEFAULT '0',
	"other_deductions" json DEFAULT '[]'::json,
	"gross_pay" text NOT NULL,
	"total_deductions" text NOT NULL,
	"net_pay" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"pdf_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permission" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "permission_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"product_code" text NOT NULL,
	"description" text,
	"unit_price" text,
	"uom" text,
	"supplier" text,
	"brand" text,
	"image_key" text,
	"mda_registration_no" text,
	"mda_page_no" text,
	"mda_valid_from" timestamp,
	"mda_expired_on" timestamp,
	"mda_pdf_file" text,
	"mda_match_x" text,
	"mda_match_y" text,
	"mda_row_height" text,
	"mda_page_width" text,
	"mda_page_height" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"fullname" text,
	"ic_number" text,
	"tax_no" text,
	"epf_no" text,
	"socso_no" text,
	"date_of_birth" date,
	"gender" text,
	"nationality" text,
	"race" text,
	"marital_status" text,
	"mailing_address" text,
	"permanent_address" text,
	"phone_numbers" json DEFAULT '[]'::json,
	"personal_email" text,
	"emergency_name1" text,
	"emergency_relationship1" text,
	"emergency_phone1" text,
	"emergency_address1" text,
	"emergency_name2" text,
	"emergency_relationship2" text,
	"emergency_phone2" text,
	"emergency_address2" text,
	"bank_name" text,
	"bank_account_no" text,
	"bank_account_holder" text,
	"bank_book_url" text,
	"job_title" text,
	"department" text,
	"employment_type" text,
	"employment_status" text,
	"education_level" text,
	"field_of_study" text,
	"pdpa_consent" boolean DEFAULT false NOT NULL,
	"pdpa_consent_at" timestamp,
	"organization_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "profile_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "purchase_order" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"po_no" text NOT NULL,
	"sales_order_id" text,
	"supplier_id" text,
	"supplier_snapshot" json,
	"supplier_quotation_key" text,
	"subtotal" text DEFAULT '0' NOT NULL,
	"sst" text DEFAULT '0',
	"sst_pct" text DEFAULT '0',
	"grand_total" text DEFAULT '0' NOT NULL,
	"notes" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"expected_delivery_date" timestamp,
	"delivery_address" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_counter" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"year" integer NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_counter_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "purchase_order_customer_po" (
	"id" text PRIMARY KEY NOT NULL,
	"purchase_order_id" text NOT NULL,
	"customer_po_id" text NOT NULL,
	"customer_po_no" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_item" (
	"id" text PRIMARY KEY NOT NULL,
	"purchase_order_id" text NOT NULL,
	"row_no" integer NOT NULL,
	"product_id" text,
	"product_code" text,
	"description" text,
	"qty" text DEFAULT '1' NOT NULL,
	"uom" text,
	"unit_price" text DEFAULT '0',
	"total_price" text DEFAULT '0',
	"image_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"quotation_no" text NOT NULL,
	"mode" text DEFAULT 'single' NOT NULL,
	"group_id" text,
	"is_dummy" integer DEFAULT 0 NOT NULL,
	"customer_id" text,
	"customer_snapshot" json,
	"sales_person_id" text,
	"sales_person_name" text,
	"prepared_by_id" text,
	"prepared_by_name" text,
	"valid_until" timestamp,
	"notes" text,
	"subtotal" text DEFAULT '0' NOT NULL,
	"overall_discount_pct" text DEFAULT '0',
	"overall_discount_amt" text DEFAULT '0',
	"sst" text DEFAULT '0',
	"sst_pct" text DEFAULT '0',
	"grand_total" text DEFAULT '0' NOT NULL,
	"include_catalogue" integer DEFAULT 1 NOT NULL,
	"include_mda_certs" integer DEFAULT 1 NOT NULL,
	"show_unit_price" integer DEFAULT 1 NOT NULL,
	"show_total_price" integer DEFAULT 1 NOT NULL,
	"show_itemize_discount" integer DEFAULT 0 NOT NULL,
	"incl_mof" integer DEFAULT 1 NOT NULL,
	"incl_ssm" integer DEFAULT 1 NOT NULL,
	"incl_tcc" integer DEFAULT 1 NOT NULL,
	"incl_bank_statement" integer DEFAULT 1 NOT NULL,
	"incl_mda_establishment" integer DEFAULT 1 NOT NULL,
	"incl_lampiran12" integer DEFAULT 1 NOT NULL,
	"incl_lampiran13" integer DEFAULT 1 NOT NULL,
	"title" text DEFAULT 'Loose Items',
	"sets" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation_counter" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"year" integer NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "quotation_counter_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "quotation_item" (
	"id" text PRIMARY KEY NOT NULL,
	"quotation_id" text NOT NULL,
	"row_no" integer NOT NULL,
	"sku" text,
	"product_code" text,
	"description" text,
	"qty" text DEFAULT '1' NOT NULL,
	"uom" text,
	"unit_price" text DEFAULT '0',
	"discount_pct" text DEFAULT '0',
	"discount_amt" text DEFAULT '0',
	"total_price" text DEFAULT '0',
	"product_id" text,
	"product_name" text,
	"image_key" text,
	"mda_reg_no" text,
	"mda_validity" text,
	"has_cert" integer DEFAULT 0,
	"has_price" integer DEFAULT 0,
	"description_source" text DEFAULT 'db',
	"price_source" text DEFAULT 'db',
	"uom_source" text DEFAULT 'db',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_order" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"so_no" text NOT NULL,
	"quotation_id" text,
	"quotation_no" text,
	"linked_quotations" json,
	"customer_id" text,
	"customer_snapshot" json,
	"supplier_quotation_key" text,
	"sales_person_id" text,
	"sales_person_name" text,
	"associate_sales_persons" json,
	"subtotal" text DEFAULT '0' NOT NULL,
	"overall_discount_pct" text DEFAULT '0',
	"overall_discount_amt" text DEFAULT '0',
	"sst" text DEFAULT '0',
	"sst_pct" text DEFAULT '0',
	"grand_total" text DEFAULT '0' NOT NULL,
	"notes" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"delivery_date" timestamp,
	"delivery_address" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp,
	"approved_by" text,
	"approved_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_order_counter" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"year" integer NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sales_order_counter_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "sales_order_item" (
	"id" text PRIMARY KEY NOT NULL,
	"sales_order_id" text NOT NULL,
	"row_no" integer NOT NULL,
	"product_id" text,
	"product_code" text,
	"description" text,
	"qty" text DEFAULT '1' NOT NULL,
	"uom" text,
	"unit_price" text DEFAULT '0',
	"discount_pct" text DEFAULT '0',
	"discount_amt" text DEFAULT '0',
	"total_price" text DEFAULT '0',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	"active_organization_id" text,
	"active_team_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "supplier" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"registration_no" text,
	"address" text,
	"contact_person" text,
	"contact_no" text,
	"email" text,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_member" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_permission" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"permission_key" text NOT NULL,
	"allowed" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_commission" ADD CONSTRAINT "case_commission_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_commission" ADD CONSTRAINT "case_commission_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_commission" ADD CONSTRAINT "case_commission_claimed_by_user_id_user_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_company" ADD CONSTRAINT "customer_company_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_purchase_order" ADD CONSTRAINT "customer_purchase_order_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_purchase_order" ADD CONSTRAINT "customer_purchase_order_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_purchase_order" ADD CONSTRAINT "customer_purchase_order_quotation_id_quotation_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_purchase_order" ADD CONSTRAINT "customer_purchase_order_sales_order_id_sales_order_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_purchase_order" ADD CONSTRAINT "customer_purchase_order_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_order" ADD CONSTRAINT "delivery_order_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_order" ADD CONSTRAINT "delivery_order_sales_order_id_sales_order_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_order" ADD CONSTRAINT "delivery_order_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_order" ADD CONSTRAINT "delivery_order_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_order_counter" ADD CONSTRAINT "delivery_order_counter_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_order_item" ADD CONSTRAINT "delivery_order_item_delivery_order_id_delivery_order_id_fk" FOREIGN KEY ("delivery_order_id") REFERENCES "public"."delivery_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department" ADD CONSTRAINT "department_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_numbering_setting" ADD CONSTRAINT "document_numbering_setting_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_customer_po_id_customer_purchase_order_id_fk" FOREIGN KEY ("customer_po_id") REFERENCES "public"."customer_purchase_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_quotation_id_quotation_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_sales_order_id_sales_order_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_delivery_order_id_delivery_order_id_fk" FOREIGN KEY ("delivery_order_id") REFERENCES "public"."delivery_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_purchase_order_id_purchase_order_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_sales_person_id_user_id_fk" FOREIGN KEY ("sales_person_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_application_specialist_id_user_id_fk" FOREIGN KEY ("application_specialist_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_counter" ADD CONSTRAINT "invoice_counter_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_expense" ADD CONSTRAINT "invoice_expense_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_item" ADD CONSTRAINT "invoice_item_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_department" ADD CONSTRAINT "member_department_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_department" ADD CONSTRAINT "member_department_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_department" ADD CONSTRAINT "member_department_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_profile" ADD CONSTRAINT "organization_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_role" ADD CONSTRAINT "organization_role_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_period" ADD CONSTRAINT "payroll_period_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_period" ADD CONSTRAINT "payroll_period_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_period" ADD CONSTRAINT "payroll_period_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip" ADD CONSTRAINT "payslip_period_id_payroll_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_period"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip" ADD CONSTRAINT "payslip_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip" ADD CONSTRAINT "payslip_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_sales_order_id_sales_order_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_counter" ADD CONSTRAINT "purchase_order_counter_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_customer_po" ADD CONSTRAINT "purchase_order_customer_po_purchase_order_id_purchase_order_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_customer_po" ADD CONSTRAINT "purchase_order_customer_po_customer_po_id_customer_purchase_order_id_fk" FOREIGN KEY ("customer_po_id") REFERENCES "public"."customer_purchase_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_purchase_order_id_purchase_order_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_sales_person_id_user_id_fk" FOREIGN KEY ("sales_person_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_prepared_by_id_user_id_fk" FOREIGN KEY ("prepared_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_counter" ADD CONSTRAINT "quotation_counter_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_item" ADD CONSTRAINT "quotation_item_quotation_id_quotation_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_quotation_id_quotation_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_sales_person_id_user_id_fk" FOREIGN KEY ("sales_person_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_counter" ADD CONSTRAINT "sales_order_counter_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_item" ADD CONSTRAINT "sales_order_item_sales_order_id_sales_order_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission" ADD CONSTRAINT "user_permission_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission" ADD CONSTRAINT "user_permission_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "case_commission_invoice_idx" ON "case_commission" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "case_commission_org_idx" ON "case_commission" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "customer_org_idx" ON "customer" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "customer_company_customer_idx" ON "customer_company" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_po_org_idx" ON "customer_purchase_order" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_order_no_org_uidx" ON "delivery_order" USING btree ("organization_id","do_no");--> statement-breakpoint
CREATE INDEX "delivery_order_org_idx" ON "delivery_order" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "delivery_order_item_do_idx" ON "delivery_order_item" USING btree ("delivery_order_id");--> statement-breakpoint
CREATE INDEX "department_organizationId_idx" ON "department" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "department_org_name_unique" ON "department" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_numbering_org_doc_uq" ON "document_numbering_setting" USING btree ("organization_id","document_type");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_no_org_uidx" ON "invoice" USING btree ("organization_id","invoice_no");--> statement-breakpoint
CREATE INDEX "invoice_org_idx" ON "invoice" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invoice_customer_idx" ON "invoice" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "invoice_expense_invoice_idx" ON "invoice_expense" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_item_invoice_idx" ON "invoice_item" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_department_unique" ON "member_department" USING btree ("member_id","department_id");--> statement-breakpoint
CREATE INDEX "member_department_memberId_idx" ON "member_department" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "member_department_orgId_idx" ON "member_department" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notification" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notification_org_idx" ON "notification" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "notification_unread_idx" ON "notification" USING btree ("user_id","is_read");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_period_month_year_org_uidx" ON "payroll_period" USING btree ("organization_id","month","year");--> statement-breakpoint
CREATE INDEX "payroll_period_org_idx" ON "payroll_period" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payslip_period_user_uidx" ON "payslip" USING btree ("period_id","user_id");--> statement-breakpoint
CREATE INDEX "payslip_user_idx" ON "payslip" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payslip_period_idx" ON "payslip" USING btree ("period_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_code_org_uidx" ON "product" USING btree ("product_code","organization_id");--> statement-breakpoint
CREATE INDEX "product_org_idx" ON "product" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_no_org_uidx" ON "purchase_order" USING btree ("organization_id","po_no");--> statement-breakpoint
CREATE INDEX "purchase_order_org_idx" ON "purchase_order" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "po_customer_po_po_idx" ON "purchase_order_customer_po" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "po_customer_po_cpo_idx" ON "purchase_order_customer_po" USING btree ("customer_po_id");--> statement-breakpoint
CREATE INDEX "purchase_order_item_po_idx" ON "purchase_order_item" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotation_no_org_uidx" ON "quotation" USING btree ("organization_id","quotation_no");--> statement-breakpoint
CREATE INDEX "quotation_org_idx" ON "quotation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "quotation_item_quotation_idx" ON "quotation_item" USING btree ("quotation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_order_no_org_uidx" ON "sales_order" USING btree ("organization_id","so_no");--> statement-breakpoint
CREATE INDEX "sales_order_org_idx" ON "sales_order" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sales_order_item_so_idx" ON "sales_order_item" USING btree ("sales_order_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "supplier_org_idx" ON "supplier" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "team_organizationId_idx" ON "team" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "team_member_teamId_idx" ON "team_member" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "team_member_userId_idx" ON "team_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_permission_user_idx" ON "user_permission" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_permission_org_idx" ON "user_permission" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_permission_unique" ON "user_permission" USING btree ("user_id","organization_id","permission_key");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");