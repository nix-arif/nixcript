-- Performance review: HR chooses in the template which parts must be filled in.
--  * criterion: allow_na (N/A may be chosen; default yes, as before), comment_on_extremes (a reviewer giving the lowest
--    or highest rating must say why; default no)
--  * written question: "required" inside review_template.questions / review.questions (json; absent = optional)
--  * reviewer's part: next review date required, action plan (at least one goal) required (default no, as before)
-- The criteria and questions are copied into each review when it is opened (review.criteria / review.questions json),
-- and so are the two reviewer rules, so a later template edit changes no review already opened.
ALTER TABLE "review_criterion" ADD COLUMN IF NOT EXISTS "allow_na" boolean NOT NULL DEFAULT true;
ALTER TABLE "review_criterion" ADD COLUMN IF NOT EXISTS "comment_on_extremes" boolean NOT NULL DEFAULT false;
ALTER TABLE "review_template" ADD COLUMN IF NOT EXISTS "require_next_review_date" boolean NOT NULL DEFAULT false;
ALTER TABLE "review_template" ADD COLUMN IF NOT EXISTS "require_action_plan" boolean NOT NULL DEFAULT false;
ALTER TABLE "review" ADD COLUMN IF NOT EXISTS "require_next_review_date" boolean NOT NULL DEFAULT false;
ALTER TABLE "review" ADD COLUMN IF NOT EXISTS "require_action_plan" boolean NOT NULL DEFAULT false;
