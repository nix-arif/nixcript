import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

async function run() {
  const sql = neon(process.env.DATABASE_URL!);

  console.log("Applying migration 0029: sales_order_item.description_source text → json");
  const [col] = await sql`
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'sales_order_item' AND column_name = 'description_source'
  `;
  if (!col) {
    console.log("  Column not found, skipping.");
  } else if (col.data_type === "json" || col.data_type === "jsonb") {
    console.log(`  Already ${col.data_type}, skipping.`);
  } else {
    await sql`
      ALTER TABLE "sales_order_item"
        ALTER COLUMN "description_source" TYPE json
        USING CASE
          WHEN "description_source" IS NULL THEN NULL
          ELSE to_json(ARRAY["description_source"])
        END
    `;
    console.log("  Done.");
  }

  console.log("Applying migration 0031: sales_order_item field source columns");
  const [colCheck] = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'sales_order_item' AND column_name = 'code_source'
  `;
  if (colCheck) {
    console.log("  Already exists, skipping.");
  } else {
    await sql`
      ALTER TABLE "sales_order_item"
        ADD COLUMN "code_source" text,
        ADD COLUMN "qty_source" text,
        ADD COLUMN "uom_source" text,
        ADD COLUMN "unit_price_source" text,
        ADD COLUMN "discount_source" text
    `;
    console.log("  Done.");
  }

  console.log("Applying migration 0032: sales_order_item code_source/qty_source text → json, add so_edited_by");
  const [codeColType] = await sql`
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'sales_order_item' AND column_name = 'code_source'
  `;
  if (!codeColType) {
    console.log("  code_source column not found, skipping.");
  } else if (codeColType.data_type === "json" || codeColType.data_type === "jsonb") {
    console.log(`  code_source already ${codeColType.data_type}, skipping type change.`);
  } else {
    await sql`
      ALTER TABLE "sales_order_item"
        ALTER COLUMN "code_source" TYPE json
        USING CASE WHEN "code_source" IS NULL THEN NULL ELSE to_json(ARRAY["code_source"]) END,
        ALTER COLUMN "qty_source" TYPE json
        USING CASE WHEN "qty_source" IS NULL THEN NULL ELSE to_json(ARRAY["qty_source"]) END
    `;
    console.log("  code_source/qty_source converted to json.");
  }
  const [soEditedByCol] = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'sales_order_item' AND column_name = 'so_edited_by'
  `;
  if (soEditedByCol) {
    console.log("  so_edited_by already exists, skipping.");
  } else {
    await sql`ALTER TABLE "sales_order_item" ADD COLUMN "so_edited_by" text`;
    console.log("  so_edited_by added.");
  }

  console.log("Applying migration 0033: urgent SO type columns");
  const [urgentCol] = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'sales_order' AND column_name = 'urgent_auth_type'
  `;
  if (urgentCol) {
    console.log("  Already exists, skipping.");
  } else {
    await sql`
      ALTER TABLE "sales_order"
        ADD COLUMN "urgent_auth_type" text,
        ADD COLUMN "urgent_auth_by" text,
        ADD COLUMN "urgent_auth_date" text,
        ADD COLUMN "urgent_po_expected_by" text,
        ADD COLUMN "urgent_auth_notes" text
    `;
    console.log("  Done.");
  }

  console.log("All pending migrations applied.");
}

run().catch((e) => { console.error(e); process.exit(1); });
