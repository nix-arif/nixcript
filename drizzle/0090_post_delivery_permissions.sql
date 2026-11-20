-- Permissions for problems found after delivery and supplier claims (see 0089). Owners already have every permission.
-- Granted to the roles that lib/permissions/constants.ts gives them to by default:
--   sales manager   customer-issue:read/create/update, supplier-claim:read
--   sales member    customer-issue:read/create
--   logistic manager customer-issue:read/update, supplier-claim:read/manage/terms
INSERT INTO "permission" ("id", "key", "label") VALUES
  (gen_random_uuid()::text, 'customer-issue:read',   'View Customer Issues (problems reported after delivery)'),
  (gen_random_uuid()::text, 'customer-issue:create', 'Report a Customer Issue'),
  (gen_random_uuid()::text, 'customer-issue:update', 'Update Customer Issues (status, evidence, customer resolution)'),
  (gen_random_uuid()::text, 'supplier-claim:read',   'View Supplier Claims'),
  (gen_random_uuid()::text, 'supplier-claim:manage', 'Manage Supplier Claims (raise, send, record the supplier''s answer, close)'),
  (gen_random_uuid()::text, 'supplier-claim:terms',  'Set Each Supplier''s Claim Terms (claim window and what it is counted from)')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "user_permission" ("id", "user_id", "organization_id", "permission_key", "allowed")
SELECT gen_random_uuid()::text, m."user_id", m."organization_id", g.key, true
FROM "member_department" md
JOIN "member" m ON m."id" = md."member_id"
JOIN "department" d ON d."id" = md."department_id"
JOIN (VALUES
  ('sales', 'manager', 'customer-issue:read'), ('sales', 'manager', 'customer-issue:create'), ('sales', 'manager', 'customer-issue:update'), ('sales', 'manager', 'supplier-claim:read'),
  ('sales', 'member',  'customer-issue:read'), ('sales', 'member',  'customer-issue:create'),
  ('logistic', 'manager', 'customer-issue:read'), ('logistic', 'manager', 'customer-issue:update'),
  ('logistic', 'manager', 'supplier-claim:read'), ('logistic', 'manager', 'supplier-claim:manage'), ('logistic', 'manager', 'supplier-claim:terms')
) AS g(dept, role, key) ON g.dept = d."name" AND g.role = md."role"
WHERE m."deleted_at" IS NULL
ON CONFLICT ("user_id", "organization_id", "permission_key") DO NOTHING;
