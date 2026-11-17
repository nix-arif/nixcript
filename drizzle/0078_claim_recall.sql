-- Owner recall of an approved claim: who recalled it, when and why (the latest recall).
ALTER TABLE "claim_application" ADD COLUMN IF NOT EXISTS "recalled_by" text REFERENCES "user"("id");
ALTER TABLE "claim_application" ADD COLUMN IF NOT EXISTS "recalled_at" timestamp;
ALTER TABLE "claim_application" ADD COLUMN IF NOT EXISTS "recall_reason" text;
