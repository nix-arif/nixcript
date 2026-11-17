-- The date a PO is made out (can be earlier than the day it is entered). It decides which organization handles a
-- restricted supplier (supplier handover dates). null = the day the PO was created.
ALTER TABLE "purchase_order" ADD COLUMN IF NOT EXISTS "po_date" date;
