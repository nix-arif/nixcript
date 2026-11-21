-- Permission to delete a performance review template (only one no review period uses). Owners already have every permission.
-- Granted to everyone who already manages performance reviews (review:manage), as the "Performance Review: HR" bundle
-- in lib/permissions/constants.ts now includes it. Everyone else gets it only when an owner assigns it.
INSERT INTO "permission" ("id", "key", "label")
VALUES (gen_random_uuid()::text, 'review:template:delete', 'Delete Performance Review Templates (only ones no review period uses)')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "user_permission" ("id", "user_id", "organization_id", "permission_key", "allowed")
SELECT gen_random_uuid()::text, up."user_id", up."organization_id", 'review:template:delete', true
FROM "user_permission" up
WHERE up."permission_key" = 'review:manage' AND up."allowed" = true
ON CONFLICT ("user_id", "organization_id", "permission_key") DO NOTHING;
