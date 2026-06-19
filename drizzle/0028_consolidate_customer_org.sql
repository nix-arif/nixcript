-- Consolidate customer org tables:
-- 1. Add customer_organization_id FK to customer_company
-- 2. Drop old flat text columns (organization_name, organization_address)
-- 3. Drop redundant customer_organization_member table

ALTER TABLE "customer_company" ADD COLUMN IF NOT EXISTS "customer_organization_id" text REFERENCES "customer_organization"("id") ON DELETE SET NULL;

ALTER TABLE "customer_company" DROP COLUMN IF EXISTS "organization_name";
ALTER TABLE "customer_company" DROP COLUMN IF EXISTS "organization_address";

DROP TABLE IF EXISTS "customer_organization_member" CASCADE;
