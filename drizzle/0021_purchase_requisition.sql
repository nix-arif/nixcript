CREATE TABLE "purchase_requisition" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "pr_no" text NOT NULL,
  "sales_order_id" text REFERENCES "sales_order"("id"),
  "sales_order_no" text,
  "status" text NOT NULL DEFAULT 'draft',
  "notes" text,
  "requested_by" text NOT NULL REFERENCES "user"("id"),
  "approved_by" text REFERENCES "user"("id"),
  "approved_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "purchase_requisition_no_org_uidx" ON "purchase_requisition" ("organization_id","pr_no");
CREATE INDEX "purchase_requisition_org_idx" ON "purchase_requisition" ("organization_id");

CREATE TABLE "purchase_requisition_item" (
  "id" text PRIMARY KEY NOT NULL,
  "purchase_requisition_id" text NOT NULL REFERENCES "purchase_requisition"("id") ON DELETE CASCADE,
  "row_no" integer NOT NULL,
  "product_id" text,
  "product_code" text,
  "description" text,
  "qty" text NOT NULL DEFAULT '1',
  "uom" text,
  "estimated_unit_cost" text DEFAULT '0',
  "total_estimated_cost" text DEFAULT '0',
  "preferred_supplier_id" text,
  "preferred_supplier_name" text,
  "purchase_order_id" text,
  "purchase_order_no" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "purchase_requisition_item_pr_idx" ON "purchase_requisition_item" ("purchase_requisition_id");
