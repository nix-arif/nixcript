-- Permission to discontinue / reactivate a product (and set its replacement). Owners already have every permission.
-- Granted to the engineering managers, who also hold product:seed. Everyone else gets it only when an owner assigns it.
INSERT INTO "permission" ("id", "key", "label")
VALUES (gen_random_uuid()::text, 'product:discontinue', 'Discontinue / Reactivate Products')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "user_permission" ("id", "user_id", "organization_id", "permission_key", "allowed")
SELECT gen_random_uuid()::text, m."user_id", m."organization_id", 'product:discontinue', true
FROM "member_department" md
JOIN "member" m ON m."id" = md."member_id"
JOIN "department" d ON d."id" = md."department_id"
WHERE m."deleted_at" IS NULL AND d."name" = 'engineering' AND md."role" = 'manager'
ON CONFLICT ("user_id", "organization_id", "permission_key") DO NOTHING;
