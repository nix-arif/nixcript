-- Company code (two digits, unique inside the owner's group of organizations): the 01 in the lot number 01-260005-052-24-001.
-- lot_no: the lot number of a packing list line (<company>-<YY><packing list no>-<PO no>-<PO line>), set when the
-- goods are received and never changed after.
ALTER TABLE "organization_profile" ADD COLUMN IF NOT EXISTS "company_code" text;
ALTER TABLE "packing_list_item" ADD COLUMN IF NOT EXISTS "lot_no" text;
