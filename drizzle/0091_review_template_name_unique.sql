-- A review template's name is unique inside its company, ignoring capitals and extra spaces
-- ("Annual  Review" = "annual review"). The same name may be used by another company of the owner.
-- The key is the same as templateNameKey() in lib/performance/core.ts: whitespace runs made one space, trimmed, lower case.

-- 1. Data step: rename the templates that already share a name. The oldest keeps its name, the others become
--    "Name (copy)", "Name (copy 2)" ... (the first of those not taken), the same as the app names a copy.
--    Reviews keep their own copy of the template name, so no review changes.
DO $$
DECLARE
  t record;
  candidate text;
  i int;
BEGIN
  FOR t IN
    SELECT id, organization_id, name
    FROM (
      SELECT id, organization_id, name, created_at,
             row_number() OVER (
               PARTITION BY organization_id, lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))
               ORDER BY created_at, id
             ) AS n
      FROM review_template
    ) d
    WHERE d.n > 1
    ORDER BY organization_id, created_at, id -- the older duplicate gets the lower number
  LOOP
    i := 1;
    LOOP
      candidate := btrim(regexp_replace(t.name, '\s+', ' ', 'g')) || CASE WHEN i = 1 THEN ' (copy)' ELSE ' (copy ' || i || ')' END;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM review_template
        WHERE organization_id = t.organization_id
          AND lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) = lower(candidate)
      );
      i := i + 1;
    END LOOP;
    UPDATE review_template SET name = candidate WHERE id = t.id;
  END LOOP;
END $$;

-- 2. The index itself
DROP INDEX IF EXISTS "review_template_org_name_uidx";
CREATE UNIQUE INDEX IF NOT EXISTS "review_template_org_name_uidx"
  ON "review_template" ("organization_id", lower(btrim(regexp_replace("name", '\s+', ' ', 'g'))));
