-- Performance review: the employee can disagree with a signed-off review, and HR settles it.
--  * employee_response / employee_comment: given with the acknowledgment (agree | disagree; a comment is required to disagree)
--  * dispute_resolution / _by / _at: HR kept the marks, and said why
--  * history: the earlier rounds when HR reopened the review to the manager instead (marks, score, sign-off, response)
-- Additive only: existing reviews keep working (no response = acknowledged before this existed, or not yet).
ALTER TABLE "review" ADD COLUMN IF NOT EXISTS "employee_response" text;
ALTER TABLE "review" ADD COLUMN IF NOT EXISTS "employee_comment" text;
ALTER TABLE "review" ADD COLUMN IF NOT EXISTS "dispute_resolution" text;
ALTER TABLE "review" ADD COLUMN IF NOT EXISTS "dispute_resolved_by" text REFERENCES "user"("id");
ALTER TABLE "review" ADD COLUMN IF NOT EXISTS "dispute_resolved_at" timestamp;
ALTER TABLE "review" ADD COLUMN IF NOT EXISTS "history" json NOT NULL DEFAULT '[]';
