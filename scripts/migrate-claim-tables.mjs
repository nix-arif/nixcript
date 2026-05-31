import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const sql = `
DROP TABLE IF EXISTS claim_mileage_item CASCADE;

CREATE TABLE IF NOT EXISTS claim_line_item (
  "id" text PRIMARY KEY NOT NULL,
  "application_id" text NOT NULL REFERENCES claim_application(id) ON DELETE CASCADE,
  "organization_id" text NOT NULL,
  "category" text NOT NULL,
  "line_date" text NOT NULL,
  "description" text,
  "from_location" text,
  "to_location" text,
  "distance_km" text,
  "rate_per_unit" text,
  "venue" text,
  "destination" text,
  "currency" text,
  "amount_foreign" text,
  "exchange_rate" text,
  "amount_myr" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS claim_line_item_app_idx ON claim_line_item (application_id);
CREATE INDEX IF NOT EXISTS claim_line_item_org_idx ON claim_line_item (organization_id);

CREATE TABLE IF NOT EXISTS claim_entertainment_detail (
  "id" text PRIMARY KEY NOT NULL,
  "application_id" text NOT NULL UNIQUE REFERENCES claim_application(id) ON DELETE CASCADE,
  "organization_id" text NOT NULL,
  "event_date" text NOT NULL,
  "restaurant_name" text NOT NULL,
  "customer_name" text NOT NULL,
  "department_organization" text NOT NULL,
  "purpose" text NOT NULL,
  "amount" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
`;

try {
  await pool.query(sql);
  console.log("[✓] Migration applied");
} catch (e) {
  console.error("Error:", e.message);
} finally {
  await pool.end();
}
