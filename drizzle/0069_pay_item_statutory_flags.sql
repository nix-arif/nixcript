-- Per-statutory flags on pay items: which of EPF / SOCSO / EIS / PCB an earning counts toward.
-- Replaces the single statutory (wage) + taxable pair.
ALTER TABLE "pay_item" ADD COLUMN IF NOT EXISTS "in_epf" boolean NOT NULL DEFAULT false;
ALTER TABLE "pay_item" ADD COLUMN IF NOT EXISTS "in_socso" boolean NOT NULL DEFAULT false;
ALTER TABLE "pay_item" ADD COLUMN IF NOT EXISTS "in_eis" boolean NOT NULL DEFAULT false;
ALTER TABLE "pay_item" ADD COLUMN IF NOT EXISTS "in_pcb" boolean NOT NULL DEFAULT false;
UPDATE "pay_item" SET "in_epf" = true, "in_socso" = true, "in_eis" = true, "in_pcb" = true WHERE "statutory" = true;
UPDATE "pay_item" SET "in_pcb" = true WHERE "taxable" = true;
ALTER TABLE "pay_item" DROP COLUMN IF EXISTS "statutory";
ALTER TABLE "pay_item" DROP COLUMN IF EXISTS "taxable";
