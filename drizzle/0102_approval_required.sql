-- Per company and document: whether it needs approval at all (Approvals page). Null = yes (as before);
-- false = submitting it confirms it at once (sales orders, purchase requisitions).
ALTER TABLE "approval_setting" ADD COLUMN IF NOT EXISTS "approval_required" boolean;
