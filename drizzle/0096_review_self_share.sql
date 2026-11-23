-- Performance review: HR decides per template whether the employee's self-assessment counts toward the final score,
-- and by how much (0-50 %, default 0 = it does not count, as before). Copied into each review when it is opened.
--   final score = reviewers' score x (100 - self_share)% + employee's own score x self_share%
ALTER TABLE "review_template" ADD COLUMN IF NOT EXISTS "self_share" integer NOT NULL DEFAULT 0;
ALTER TABLE "review" ADD COLUMN IF NOT EXISTS "self_share" integer NOT NULL DEFAULT 0;
