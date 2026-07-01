-- Convert description_source from text to json, wrapping existing string values in arrays
ALTER TABLE "sales_order_item"
  ALTER COLUMN "description_source" TYPE json
  USING CASE
    WHEN "description_source" IS NULL THEN NULL
    ELSE to_json(ARRAY["description_source"])
  END;
