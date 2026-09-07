-- Owner-level governance: restricts a real-world supplier (matched by name,
-- since supplier records have no shared identity across an owner's
-- different orgs) to being dealt with directly by only one designated
-- organization. Enforced in server/supplier-restrictions.ts.
CREATE TABLE "restricted_supplier" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "supplier_name" text NOT NULL,
  "supplier_name_normalized" text NOT NULL,
  "designated_organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "notes" text,
  "created_by" text NOT NULL REFERENCES "user"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "restricted_supplier_owner_name_uidx" ON "restricted_supplier" ("owner_user_id", "supplier_name_normalized");
CREATE INDEX "restricted_supplier_owner_idx" ON "restricted_supplier" ("owner_user_id");
