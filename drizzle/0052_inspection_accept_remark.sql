-- Packing list inspection: remark (with optional photos/videos) on stock that is
-- still accepted. Photos/videos reuse inspection_photo with category "accept".
ALTER TABLE "packing_list_item" ADD COLUMN "draft_accept_notes" text;
ALTER TABLE "goods_receipt_item" ADD COLUMN "accept_notes" text;
