-- Live refresh: bump change_counter(organization_id, scope) whenever an
-- area's tables change, so open pages know to re-fetch (app/api/live).
-- Statement-level triggers: one small upsert per company touched by a save,
-- not one per row, so bulk imports stay cheap.
-- Safe to run again (idempotent). Run on dev, and on prod at rollout:
--   psql "$DATABASE_URL" -f scripts/live-triggers.sql   (use the direct, non-pooled URL)

SET client_min_messages = warning;

CREATE TABLE IF NOT EXISTS change_counter (
  organization_id text NOT NULL,
  scope text NOT NULL,
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, scope)
);

CREATE OR REPLACE FUNCTION live_bump() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO change_counter (organization_id, scope, version, updated_at)
      SELECT DISTINCT organization_id, TG_ARGV[0], 1, now() FROM old_rows WHERE organization_id IS NOT NULL
      ON CONFLICT (organization_id, scope) DO UPDATE SET version = change_counter.version + 1, updated_at = now();
  ELSE
    INSERT INTO change_counter (organization_id, scope, version, updated_at)
      SELECT DISTINCT organization_id, TG_ARGV[0], 1, now() FROM new_rows WHERE organization_id IS NOT NULL
      ON CONFLICT (organization_id, scope) DO UPDATE SET version = change_counter.version + 1, updated_at = now();
  END IF;
  RETURN NULL;
END $$;

DO $$
DECLARE
  m record;
BEGIN
  FOR m IN SELECT * FROM (VALUES
    ('quotation', 'quotation'),
    ('sales_order', 'sales'), ('customer_purchase_order', 'sales'),
    ('delivery_order', 'delivery'), ('case_template', 'delivery'),
    ('invoice', 'invoice'),
    ('stock_level', 'inventory'), ('stock_movement', 'inventory'), ('stock_lot', 'inventory'),
    ('asset_unit', 'inventory'), ('stock_request', 'inventory'),
    ('consign_header', 'consignment'), ('consign_event', 'consignment'), ('consign_settlement', 'consignment'),
    ('consign_partner', 'consignment'), ('consign_setting', 'consignment'),
    ('purchase_order', 'purchase'), ('purchase_requisition', 'purchase'), ('goods_receipt', 'purchase'), ('packing_list', 'purchase'),
    ('customer', 'customer'), ('customer_organization', 'customer'),
    ('supplier', 'supplier'),
    ('claim_application', 'hr'), ('leave_application', 'hr'), ('travel_form', 'hr')
  ) AS t(tbl, scope)
  LOOP
    IF to_regclass('public.' || m.tbl) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS live_ins ON %I', m.tbl);
    EXECUTE format('DROP TRIGGER IF EXISTS live_upd ON %I', m.tbl);
    EXECUTE format('DROP TRIGGER IF EXISTS live_del ON %I', m.tbl);
    EXECUTE format('CREATE TRIGGER live_ins AFTER INSERT ON %I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION live_bump(%L)', m.tbl, m.scope);
    EXECUTE format('CREATE TRIGGER live_upd AFTER UPDATE ON %I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION live_bump(%L)', m.tbl, m.scope);
    EXECUTE format('CREATE TRIGGER live_del AFTER DELETE ON %I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION live_bump(%L)', m.tbl, m.scope);
  END LOOP;
END $$;
