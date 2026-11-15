-- PCB tax-free limit on pay items removed (functionality not settled yet).
ALTER TABLE "pay_item" DROP COLUMN IF EXISTS "tax_free_limit";
