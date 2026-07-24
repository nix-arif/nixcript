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

  console.log("Applying migration 0041/0042: warrant_2026 tables");
  // Drop old fixed-column table if it exists (from 0041 before the flexible redesign)
  const [oldWarrantCol] = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'warrant_2026_row' AND column_name = 'warran_no'
  `;
  if (oldWarrantCol) {
    console.log("  Dropping old fixed-column warrant_2026_row...");
    await sql`DROP TABLE IF EXISTS "warrant_2026_row"`;
    console.log("  Done.");
  }

  const [configTable] = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_name = 'warrant_2026_config'
  `;
  if (configTable) {
    console.log("  warrant_2026_config already exists, skipping.");
  } else {
    await sql`
      CREATE TABLE "warrant_2026_config" (
        "organization_id" text PRIMARY KEY REFERENCES "organization"("id") ON DELETE CASCADE,
        "columns"         json NOT NULL DEFAULT '[]',
        "updated_at"      timestamp DEFAULT now() NOT NULL
      )
    `;
    console.log("  warrant_2026_config created.");
  }

  const [rowTable] = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_name = 'warrant_2026_row'
  `;
  if (rowTable) {
    console.log("  warrant_2026_row already exists, skipping.");
  } else {
    await sql`
      CREATE TABLE "warrant_2026_row" (
        "id"               text PRIMARY KEY NOT NULL,
        "organization_id"  text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
        "row_index"        integer NOT NULL DEFAULT 0,
        "cells"            json NOT NULL DEFAULT '[]',
        "updated_by"       text REFERENCES "user"("id") ON DELETE SET NULL,
        "updated_by_name"  text,
        "created_at"       timestamp DEFAULT now() NOT NULL,
        "updated_at"       timestamp DEFAULT now() NOT NULL
      )
    `;
    await sql`CREATE INDEX "warrant_2026_org_idx" ON "warrant_2026_row" ("organization_id")`;
    await sql`CREATE INDEX "warrant_2026_row_order_idx" ON "warrant_2026_row" ("organization_id", "row_index")`;
    console.log("  warrant_2026_row created.");
  }

  console.log("Applying migration 0043: warrant_2026_config add sheet_url");
  const [sheetUrlCol] = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'warrant_2026_config' AND column_name = 'sheet_url'
  `;
  if (sheetUrlCol) {
    console.log("  sheet_url already exists, skipping.");
  } else {
    await sql`ALTER TABLE "warrant_2026_config" ADD COLUMN "sheet_url" text`;
    console.log("  sheet_url added.");
  }

  console.log("All pending migrations applied.");
}

run().catch((e) => { console.error(e); process.exit(1); });
