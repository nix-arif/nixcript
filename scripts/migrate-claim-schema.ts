import * as dotenv from "dotenv";
dotenv.config();
import { neon } from "@neondatabase/serverless";
import { nanoid } from "nanoid";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  // Add hotel_cap_per_night to claim_type
  await sql`
    ALTER TABLE claim_type
    ADD COLUMN IF NOT EXISTS hotel_cap_per_night text
  `;
  console.log("Added: claim_type.hotel_cap_per_night");

  // Add line_item_id to claim_document (from previous session)
  await sql`
    ALTER TABLE claim_document
    ADD COLUMN IF NOT EXISTS line_item_id text
      REFERENCES claim_line_item(id) ON DELETE SET NULL
  `;
  console.log("Added: claim_document.line_item_id");

  // Add meal rate columns to claim_type
  await sql`ALTER TABLE claim_type ADD COLUMN IF NOT EXISTS meal_breakfast_rate text`;
  console.log("Added: claim_type.meal_breakfast_rate");
  await sql`ALTER TABLE claim_type ADD COLUMN IF NOT EXISTS meal_lunch_rate text`;
  console.log("Added: claim_type.meal_lunch_rate");
  await sql`ALTER TABLE claim_type ADD COLUMN IF NOT EXISTS meal_dinner_rate text`;
  console.log("Added: claim_type.meal_dinner_rate");

  // Add approval columns to stock_movement
  await sql`ALTER TABLE stock_movement ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'APPROVED'`;
  await sql`ALTER TABLE stock_movement ADD COLUMN IF NOT EXISTS reviewed_by text REFERENCES "user"(id)`;
  await sql`ALTER TABLE stock_movement ADD COLUMN IF NOT EXISTS reviewed_at timestamp`;
  await sql`ALTER TABLE stock_movement ADD COLUMN IF NOT EXISTS review_comment text`;
  // Make balance_after nullable
  await sql`ALTER TABLE stock_movement ALTER COLUMN balance_after DROP NOT NULL`;
  console.log("Added: stock_movement approval columns");

  // Seed inventory:approve permission
  await sql`INSERT INTO permission (id, key, label) VALUES (${nanoid()}, 'inventory:approve', 'Approve / Reject Stock Movements') ON CONFLICT (key) DO NOTHING`;
  console.log("Seeded: inventory:approve permission");

  // Add warehouse columns to inventory tables (idempotent)
  await sql`ALTER TABLE stock_level ADD COLUMN IF NOT EXISTS warehouse_label text NOT NULL DEFAULT 'Default'`;
  console.log("Added: stock_level.warehouse_label");
  await sql`ALTER TABLE stock_movement ADD COLUMN IF NOT EXISTS warehouse_label text NOT NULL DEFAULT 'Default'`;
  await sql`ALTER TABLE stock_movement ADD COLUMN IF NOT EXISTS warehouse_to text`;
  console.log("Added: stock_movement.warehouse_label + warehouse_to");

  // Re-create unique constraint to include warehouse
  await sql`ALTER TABLE stock_level DROP CONSTRAINT IF EXISTS stock_level_product_org_uidx`;
  await sql`DROP INDEX IF EXISTS stock_level_product_org_uidx`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS stock_level_product_wh_uidx ON stock_level (product_id, organization_id, warehouse_label)`;
  await sql`CREATE INDEX IF NOT EXISTS stock_level_wh_idx ON stock_level (organization_id, warehouse_label)`;
  console.log("Updated: stock_level unique constraint");

  // Inventory tables
  await sql`
    CREATE TABLE IF NOT EXISTS stock_level (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      product_id text NOT NULL REFERENCES product(id) ON DELETE CASCADE,
      quantity text NOT NULL DEFAULT '0',
      reserved_qty text NOT NULL DEFAULT '0',
      unit_cost text,
      reorder_point text,
      max_stock text,
      updated_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT stock_level_product_org_uidx UNIQUE (product_id, organization_id)
    )
  `;
  console.log("Created: stock_level");

  await sql`CREATE INDEX IF NOT EXISTS stock_level_org_idx ON stock_level (organization_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS stock_movement (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      product_id text NOT NULL REFERENCES product(id) ON DELETE CASCADE,
      product_code text NOT NULL,
      movement_type text NOT NULL,
      quantity text NOT NULL,
      balance_after text NOT NULL,
      unit_cost text,
      reference_type text NOT NULL DEFAULT 'MANUAL',
      reference_id text,
      reference_no text,
      notes text,
      created_by text NOT NULL REFERENCES "user"(id),
      created_at timestamp NOT NULL DEFAULT now()
    )
  `;
  console.log("Created: stock_movement");

  await sql`CREATE INDEX IF NOT EXISTS stock_movement_product_idx ON stock_movement (product_id, organization_id)`;
  await sql`CREATE INDEX IF NOT EXISTS stock_movement_type_idx ON stock_movement (movement_type)`;
  await sql`CREATE INDEX IF NOT EXISTS stock_movement_org_idx ON stock_movement (organization_id)`;
  await sql`CREATE INDEX IF NOT EXISTS stock_movement_created_idx ON stock_movement (created_at)`;

  // Seed inventory permissions
  const inventoryPerms = [
    { key: "inventory:read",   label: "View Inventory" },
    { key: "inventory:adjust", label: "Adjust Stock" },
    { key: "inventory:manage", label: "Manage Inventory Settings" },
  ];
  for (const p of inventoryPerms) {
    await sql`INSERT INTO permission (id, key, label) VALUES (${nanoid()}, ${p.key}, ${p.label}) ON CONFLICT (key) DO NOTHING`;
  }
  console.log("Seeded: inventory permissions");

  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
