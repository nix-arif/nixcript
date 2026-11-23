-- Performance review: more than one reviewer.
--  * review.reviewer_user_id stays the lead reviewer: their marks stay in review_answer.manager_*, and they write
--    Section B (outcome, next review date, action plan) and submit for HR sign-off once every other reviewer is done.
--  * review_reviewer: the other reviewers, each rating every criterion on their own (review_reviewer_answer).
--  * weights are shares: the final score is each reviewer's criterion-weighted score, combined by share
--    (lead_weight for the lead). A review with only the lead works exactly as before.
--  * review_period.show_reviewer_marks: HR's choice per period whether the employee sees each reviewer's marks by
--    name, or only the combined marks.
-- Additive only.
ALTER TABLE "review_period" ADD COLUMN IF NOT EXISTS "show_reviewer_marks" boolean NOT NULL DEFAULT true;
ALTER TABLE "review" ADD COLUMN IF NOT EXISTS "lead_weight" integer NOT NULL DEFAULT 100;

CREATE TABLE IF NOT EXISTS "review_reviewer" (
  "id" text PRIMARY KEY,
  "review_id" text NOT NULL REFERENCES "review"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id"),
  "weight" integer NOT NULL DEFAULT 100,
  "designation" text,
  "summary" text,
  "submitted_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "review_reviewer_uidx" ON "review_reviewer" ("review_id", "user_id");
CREATE INDEX IF NOT EXISTS "review_reviewer_user_idx" ON "review_reviewer" ("user_id");

CREATE TABLE IF NOT EXISTS "review_reviewer_answer" (
  "id" text PRIMARY KEY,
  "reviewer_id" text NOT NULL REFERENCES "review_reviewer"("id") ON DELETE CASCADE,
  "criterion_id" text NOT NULL,
  "rating" integer,
  "na" boolean NOT NULL DEFAULT false,
  "comment" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "review_reviewer_answer_uidx" ON "review_reviewer_answer" ("reviewer_id", "criterion_id");
