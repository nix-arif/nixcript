-- Consignment: stock sent to customer on consignment, tied to a Sales Order
CREATE TABLE IF NOT EXISTS consignment_counter (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  year integer NOT NULL,
  last_number integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS consignment (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  consignment_no text NOT NULL,
  so_id text NOT NULL REFERENCES sales_order(id),
  so_no text NOT NULL,
  customer_id text REFERENCES customer(id),
  customer_snapshot json,
  sent_date timestamp,
  expiry_date timestamp,
  notes text,
  status text NOT NULL DEFAULT 'active',
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS consignment_org_idx ON consignment(organization_id);
CREATE INDEX IF NOT EXISTS consignment_so_idx ON consignment(so_id);

CREATE TABLE IF NOT EXISTS consignment_item (
  id text PRIMARY KEY,
  consignment_id text NOT NULL REFERENCES consignment(id) ON DELETE CASCADE,
  organization_id text NOT NULL,
  product_id text REFERENCES product(id),
  product_code text,
  description text NOT NULL,
  uom text,
  unit_price text NOT NULL DEFAULT '0',
  qty_sent text NOT NULL DEFAULT '0',
  qty_used text NOT NULL DEFAULT '0',
  qty_returned text NOT NULL DEFAULT '0'
);

CREATE TABLE IF NOT EXISTS consignment_usage (
  id text PRIMARY KEY,
  consignment_id text NOT NULL REFERENCES consignment(id) ON DELETE CASCADE,
  organization_id text NOT NULL,
  usage_date timestamp NOT NULL,
  type text NOT NULL,
  notes text,
  recorded_by text NOT NULL REFERENCES "user"(id),
  items json NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL
);
