-- Evidence (photos / videos) attached to a change request on a completed
-- packing list line. Such a photo belongs to its request: it only counts as
-- the line's evidence (inspect views, discrepancy reports) once the request
-- is approved; while pending — or if rejected / cancelled — it is shown only
-- on the request itself. NULL = taken during the normal inspection.
ALTER TABLE "inspection_photo"
  ADD COLUMN "amendment_id" text REFERENCES "packing_list_amendment"("id") ON DELETE CASCADE;
CREATE INDEX "inspection_photo_amendment_idx" ON "inspection_photo" ("amendment_id");
