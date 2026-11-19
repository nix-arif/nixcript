-- Performance review: the fields of the company's paper form (F-HR05) that the review did not have yet.
--  * template: written questions (achievements, challenges, career planning, corporate culture ...)
--  * review: its own copy of those questions and the employee's answers; who/what is reviewed (designation, department,
--    purpose of the review); progress on the goals of the last review; the reviewer's overall outcome, next review date
--    and action plan for the next period; the employee's acknowledgment (the signature on the paper form)
--  * answers: "N/A" for a competency that does not apply (e.g. supervision for someone who supervises nobody)
ALTER TABLE "review_template" ADD COLUMN IF NOT EXISTS "questions" json NOT NULL DEFAULT '[]';

ALTER TABLE "review" ADD COLUMN IF NOT EXISTS "questions" json NOT NULL DEFAULT '[]';
ALTER TABLE "review" ADD COLUMN IF NOT EXISTS "question_answers" json NOT NULL DEFAULT '{}';
ALTER TABLE "review" ADD COLUMN IF NOT EXISTS "purpose" text;
ALTER TABLE "review" ADD COLUMN IF NOT EXISTS "employee_designation" text;
ALTER TABLE "review" ADD COLUMN IF NOT EXISTS "employee_department" text;
ALTER TABLE "review" ADD COLUMN IF NOT EXISTS "reviewer_designation" text;
ALTER TABLE "review" ADD COLUMN IF NOT EXISTS "previous_goals" json NOT NULL DEFAULT '[]';
ALTER TABLE "review" ADD COLUMN IF NOT EXISTS "outcome" text;
ALTER TABLE "review" ADD COLUMN IF NOT EXISTS "next_review_date" date;
ALTER TABLE "review" ADD COLUMN IF NOT EXISTS "action_plan" json NOT NULL DEFAULT '[]';
ALTER TABLE "review" ADD COLUMN IF NOT EXISTS "acknowledged_at" timestamp;

ALTER TABLE "review_answer" ADD COLUMN IF NOT EXISTS "self_na" boolean NOT NULL DEFAULT false;
ALTER TABLE "review_answer" ADD COLUMN IF NOT EXISTS "manager_na" boolean NOT NULL DEFAULT false;
