-- One-off data fix: Zilarahim's (Affirma) field stock is really Smart Innosys
-- stock on consignment — it was recorded as Affirma's own before the
-- consignment module existed. Moves the remaining balance (per product and
-- lot) from Affirma's books (Field:<zilarahim>) onto Smart Innosys's books at
-- the consignment location CS:ORG:<affirma>:REP:<zilarahim>, under one new
-- open consignment (Smart Innosys → Affirma, specialist Zilarahim). Smart
-- Innosys's own warehouse is not touched — the stock is already with her.
--
-- Recorded as movements on both sides (Affirma: adjustment out; Smart
-- Innosys: consignment sent, at the consignment location) plus a consignment
-- line and "send" event per product/lot, so Field Stock, Movement History and
-- Consignment Balance all add up. One transaction; does nothing if run again.
--
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/reclassify-zilarahim-consigned.sql

\set ON_ERROR_STOP on
begin;

do $$
declare
  owner_org  constant text := 'g63wYhdti8elZdv8yfaU00YQ2xYpP8DU'; -- Smart Innosys Sdn Bhd
  agent_org  constant text := '9x4niIyrZTW3Vn78R54NbVkYvY0HXN0Z'; -- Affirma Sdn Bhd
  rep        constant text := 'MVn2G2gCRmeXBJ8TYrhAWIztlwp1snUd'; -- Zilarahim
  by_user    constant text := 'tF27HIE4jnnVv7lfYX4oxQE1HFC1F71I'; -- recorded by
  marker     constant text := 'Opening consigned stock — Zilarahim''s field stock recorded before the consignment module';
  field_lbl  constant text := 'Field:' || rep;
  cs_lbl     constant text := 'CS:ORG:' || agent_org || ':REP:' || rep;
  yr int := extract(year from now())::int;
  seq int; cs_no text; hdr_id text; src_wh text;
  lvl record; part record;
  remaining numeric; take numeric; cs_bal numeric;
  line_id text; mv_id text;
begin
  if exists (select 1 from consign_header where organization_id = owner_org and notes = marker) then
    raise notice 'Already done — nothing changed';
    return;
  end if;
  if not exists (select 1 from member where organization_id = agent_org and user_id = rep and deleted_at is null) then
    raise exception 'Zilarahim is not an Affirma member here';
  end if;

  -- next Smart Innosys consignment number (CSSI/yy-nnnn), never reusing one
  select greatest(
           coalesce((select last_number from consign_counter where organization_id = owner_org and year = yr), 0),
           coalesce((select max(substring(consignment_no from '\d+$')::int) from consign_header
                     where organization_id = owner_org and consignment_no like 'CSSI/' || to_char(now(), 'YY') || '-%'), 0)
         ) + 1 into seq;
  cs_no := 'CSSI/' || to_char(now(), 'YY') || '-' || lpad(seq::text, 4, '0');
  if exists (select 1 from consign_counter where organization_id = owner_org) then
    update consign_counter set year = yr, last_number = seq where organization_id = owner_org;
  else
    insert into consign_counter (id, organization_id, year, last_number) values (replace(gen_random_uuid()::text, '-', ''), owner_org, yr, seq);
  end if;

  -- returns go back to Smart Innosys's main (first) warehouse
  select coalesce((select w->>'label' from organization_profile op, json_array_elements(op.warehouse_addresses::json) w
                   where op.organization_id = owner_org and coalesce(w->>'label', '') <> '' limit 1), 'Default') into src_wh;

  hdr_id := replace(gen_random_uuid()::text, '-', '');
  insert into consign_header (id, organization_id, consignment_no, consignee_type, agent_org_id, agent_rep_id,
                              source_warehouse_label, location_label, status, sent_date, notes, created_by)
  values (hdr_id, owner_org, cs_no, 'agent', agent_org, rep, src_wh, cs_lbl, 'open', now(), marker, by_user);

  for lvl in
    select sl.id, sl.product_id, sl.quantity::numeric qty, sl.unit_cost, p.product_code, p.description, p.uom
    from stock_level sl join product p on p.id = sl.product_id
    where sl.organization_id = agent_org and sl.warehouse_label = field_lbl and sl.quantity::numeric > 0
    order by p.product_code
  loop
    -- Affirma: the whole balance leaves its books
    insert into stock_movement (id, organization_id, product_id, product_code, warehouse_label, warehouse_to, movement_type,
                                quantity, balance_after, reference_type, reference_id, reference_no, notes, status,
                                reviewed_by, reviewed_at, created_by, created_at)
    values (replace(gen_random_uuid()::text, '-', ''), agent_org, lvl.product_id, lvl.product_code, field_lbl, null, 'ADJUSTMENT',
            (-lvl.qty)::numeric(14,4)::text, '0.0000', 'CONSIGNMENT', hdr_id, cs_no,
            'Reclassified: Smart Innosys consigned stock (' || cs_no || ') — recorded before the consignment module',
            'APPROVED', by_user, now(), by_user, now());
    update stock_level set quantity = '0.0000', updated_at = now() where id = lvl.id;

    -- the parts: each lot (capped at what is really held), then any quantity without a lot
    remaining := lvl.qty;
    create temp table if not exists zila_parts (lot_no text, expiry_date timestamp, qty numeric) on commit drop;
    truncate zila_parts;
    for part in
      select id, lot_no, expiry_date, quantity::numeric q from stock_lot
      where organization_id = agent_org and warehouse_label = field_lbl and product_id = lvl.product_id and quantity::numeric > 0
      order by expiry_date nulls last, lot_no
    loop
      take := least(part.q, remaining);
      update stock_lot set quantity = '0.0000', updated_at = now() where id = part.id;
      if take > 0 then
        insert into zila_parts values (part.lot_no, part.expiry_date, take);
        remaining := remaining - take;
      end if;
    end loop;
    if remaining > 0 then insert into zila_parts values (null, null, remaining); end if;

    for part in select * from zila_parts loop
      -- Smart Innosys: stock level (and lot) at the consignment location
      if exists (select 1 from stock_level where organization_id = owner_org and warehouse_label = cs_lbl and product_id = lvl.product_id) then
        update stock_level set quantity = (quantity::numeric + part.qty)::numeric(14,4)::text, updated_at = now()
        where organization_id = owner_org and warehouse_label = cs_lbl and product_id = lvl.product_id
        returning quantity::numeric into cs_bal;
      else
        insert into stock_level (id, organization_id, product_id, warehouse_label, quantity, reserved_qty, unit_cost, updated_at)
        values (replace(gen_random_uuid()::text, '-', ''), owner_org, lvl.product_id, cs_lbl, part.qty::numeric(14,4)::text, '0', lvl.unit_cost, now());
        cs_bal := part.qty;
      end if;
      if part.lot_no is not null then
        if exists (select 1 from stock_lot where organization_id = owner_org and warehouse_label = cs_lbl and product_id = lvl.product_id and lot_no = part.lot_no) then
          update stock_lot set quantity = (quantity::numeric + part.qty)::numeric(14,4)::text, updated_at = now()
          where organization_id = owner_org and warehouse_label = cs_lbl and product_id = lvl.product_id and lot_no = part.lot_no;
        else
          insert into stock_lot (id, organization_id, product_id, warehouse_label, lot_no, expiry_date, quantity, reserved_qty, unit_cost)
          values (replace(gen_random_uuid()::text, '-', ''), owner_org, lvl.product_id, cs_lbl, part.lot_no, part.expiry_date, part.qty::numeric(14,4)::text, '0', lvl.unit_cost);
        end if;
      end if;
      -- Smart Innosys movement: "Consigned in" at the consignment location (stock is already with her, so no warehouse leg)
      mv_id := replace(gen_random_uuid()::text, '-', '');
      insert into stock_movement (id, organization_id, product_id, product_code, warehouse_label, warehouse_to, movement_type,
                                  quantity, balance_after, reference_type, reference_id, reference_no, notes, lot_no, expiry_date,
                                  status, reviewed_by, reviewed_at, created_by, created_at)
      values (mv_id, owner_org, lvl.product_id, lvl.product_code, cs_lbl, null, 'CONSIGN_SEND',
              part.qty::numeric(14,4)::text, cs_bal::numeric(14,4)::text, 'CONSIGNMENT', hdr_id, cs_no,
              'Consigned to Zilarahim (' || cs_no || ') — stock already with her before the consignment module',
              part.lot_no, part.expiry_date, 'APPROVED', by_user, now(), by_user, now());
      -- consignment line + send event
      line_id := replace(gen_random_uuid()::text, '-', '');
      insert into consign_line (id, consignment_id, organization_id, product_id, product_code, description, uom, lot_no, expiry_date,
                                unit_cost, qty_sent, qty_consumed, qty_returned, qty_adjusted, qty_moved)
      values (line_id, hdr_id, owner_org, lvl.product_id, lvl.product_code, lvl.description, lvl.uom, part.lot_no, part.expiry_date,
              lvl.unit_cost, part.qty::numeric(14,4)::text, '0', '0', '0', '0');
      insert into consign_event (id, consignment_id, line_id, organization_id, type, qty, event_date, reason, billable, stock_movement_id, created_by)
      values (replace(gen_random_uuid()::text, '-', ''), hdr_id, line_id, owner_org, 'send', part.qty::numeric(14,4)::text, now(),
              'opening — recorded before the consignment module', false, mv_id, by_user);
    end loop;
  end loop;

  raise notice 'Created % (Smart Innosys → Affirma, specialist Zilarahim)', cs_no;
end $$;

commit;
