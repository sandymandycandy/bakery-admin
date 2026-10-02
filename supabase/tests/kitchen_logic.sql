-- Kitchen tickets (Phase 5A). Runs in a transaction and rolls back.
-- Orders are inserted directly with order numbers from 990201, so order_number_seq is not consumed.
-- Expected outcomes are in the comment above each check.
begin;
create temp table r (n serial, check_name text, outcome text) on commit drop;
create temp table ctx (k text primary key, v text) on commit drop;
grant all on r, ctx to authenticated;
grant usage on sequence r_n_seq to authenticated;

insert into auth.users (id, email, aud, role) values
 ('00000000-0000-0000-0000-0000000007a1','kt-a@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000007c1','kt-c@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000007f1','kt-f1@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000007f2','kt-f2@t.local','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name, role) values
 ('00000000-0000-0000-0000-0000000007a1','Kt Admin','admin'),
 ('00000000-0000-0000-0000-0000000007c1','Kt Counter','counter'),
 ('00000000-0000-0000-0000-0000000007f1','Kt Chef One','chef'),
 ('00000000-0000-0000-0000-0000000007f2','Kt Chef Two','chef');
insert into public.kitchens (code, name) values ('TK1', 'T Kitchen One'), ('TK2', 'T Kitchen Two');
-- Chef one works in kitchen one only; chef two in both.
insert into public.staff_kitchens (user_id, kitchen_id)
  select '00000000-0000-0000-0000-0000000007f1'::uuid, id from public.kitchens where code = 'TK1'
  union all
  select '00000000-0000-0000-0000-0000000007f2'::uuid, id from public.kitchens where code in ('TK1', 'TK2');

-- Predictable scheduling rules (all rolled back).
delete from public.capacity_overrides;
delete from public.category_daily_caps;
delete from public.pickup_windows;
delete from public.closures;
update public.business_hours set opens_at = '09:00', closes_at = '21:00', is_closed = false;

insert into public.categories (name) values ('T Kt Bakes');
insert into public.products (category_id, name, prep_type, tax_rate_bps, allergens)
  select id, 'T Kt Cake', 'made_to_order', 500, '{milk}' from public.categories where name = 'T Kt Bakes';
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, 'T Kt Bread', 'made_to_order', 500 from public.categories where name = 'T Kt Bakes';
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, 'T Kt Puff', 'ready_stock', 1800 from public.categories where name = 'T Kt Bakes';
insert into public.product_variants (product_id, name, price_paise, lead_time_minutes, kitchen_id)
  select p.id, '1 kg', 50000, 120, k.id from public.products p, public.kitchens k where p.name = 'T Kt Cake' and k.code = 'TK1';
insert into public.product_variants (product_id, name, price_paise, lead_time_minutes, kitchen_id)
  select p.id, 'Loaf', 8000, 60, k.id from public.products p, public.kitchens k where p.name = 'T Kt Bread' and k.code = 'TK2';
insert into public.product_variants (product_id, name, price_paise)
  select id, 'Each', 3000 from public.products where name = 'T Kt Puff';
insert into ctx select 'cake', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Kt Cake';
insert into ctx select 'bread', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Kt Bread';
insert into ctx select 'puff', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Kt Puff';

-- Noon on day p_days after today, business time.
create function pg_temp.day(p_days integer) returns timestamptz language sql stable as $$
  select (((now() at time zone 'Asia/Kolkata')::date + p_days) + time '12:00') at time zone 'Asia/Kolkata'
$$;
-- Pending call order inserted straight into the table.
create function pg_temp.mk_order(p_num bigint, p_due timestamptz) returns uuid language sql as $$
  insert into public.orders (order_number, idempotency_key, source, status, customer_name, customer_phone, requested_due_at)
  values (p_num, gen_random_uuid(), 'CALL', 'pending_confirmation', 'Kt Customer', '9000000701', p_due)
  returning id
$$;
-- Order line snapshotting the catalogue, as create_order does.
create function pg_temp.mk_line(p_order uuid, p_key text, p_qty integer, p_notes text default null) returns uuid language sql as $$
  insert into public.order_items (
    order_id, line_no, product_id, variant_id, category_id, product_name, variant_name, prep_type, kitchen_id,
    is_veg, contains_egg, is_eggless, allergens, lead_time_minutes, unit_price_paise, tax_rate_bps,
    quantity, line_total_paise, tax_paise, notes)
  select p_order, coalesce((select max(line_no) from public.order_items where order_id = p_order), 0) + 1,
         p.id, pv.id, p.category_id, p.name, pv.name, p.prep_type,
         case when p.prep_type = 'made_to_order' then pv.kitchen_id end,
         p.is_veg, p.contains_egg, pv.is_eggless, p.allergens, pv.lead_time_minutes, pv.price_paise, p.tax_rate_bps,
         p_qty, pv.price_paise * p_qty, 0, p_notes
  from public.product_variants pv join public.products p on p.id = pv.product_id
  where pv.id = (select v::uuid from ctx where k = p_key)
  returning id
$$;

-- A: cake ×2 (Happy Birthday), bread ×3, puff ×1 · P: puff ×2 only · E: cake ×1, bread ×1 (edits) · Q: cake ×1 (stays pending)
insert into ctx values ('A', pg_temp.mk_order(990201, pg_temp.day(3))::text);
insert into ctx values ('P', pg_temp.mk_order(990202, pg_temp.day(3))::text);
insert into ctx values ('E', pg_temp.mk_order(990203, pg_temp.day(3))::text);
insert into ctx values ('Q', pg_temp.mk_order(990204, pg_temp.day(3))::text);
select pg_temp.mk_line((select v::uuid from ctx where k = 'A'), 'cake', 2, 'Happy Birthday');
select pg_temp.mk_line((select v::uuid from ctx where k = 'A'), 'bread', 3);
select pg_temp.mk_line((select v::uuid from ctx where k = 'A'), 'puff', 1);
select pg_temp.mk_line((select v::uuid from ctx where k = 'P'), 'puff', 2);
select pg_temp.mk_line((select v::uuid from ctx where k = 'E'), 'cake', 1);
select pg_temp.mk_line((select v::uuid from ctx where k = 'E'), 'bread', 1);
select pg_temp.mk_line((select v::uuid from ctx where k = 'Q'), 'cake', 1);
select private.recalc_order_totals(v::uuid) from ctx where k in ('A', 'P', 'E', 'Q');

set local role authenticated;

-- ===== Schema and access (Task 1) =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}', true);
do $$
begin
  -- expect: 0
  insert into r(check_name,outcome) values ('S1 no price or customer columns on kitchen tables',
    (select count(*) from information_schema.columns where table_schema = 'public'
       and table_name in ('kitchen_tickets', 'kitchen_ticket_lines', 'kitchen_issues', 'order_kitchen_progress')
       and column_name ~ '(price|paise|customer|phone)')::text);
  begin
    insert into public.kitchen_tickets (order_id, kitchen_id, reference, source, due_at, start_by)
      values ((select v::uuid from ctx where k = 'A'), (select id from public.kitchens where code = 'TK1'), 'X', 'CALL', now(), now());
    insert into r(check_name,outcome) values ('S2 direct ticket insert refused', 'ALLOWED');
  -- expect: permission denied for table kitchen_tickets
  exception when others then insert into r(check_name,outcome) values ('S2 direct ticket insert refused', sqlerrm); end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007f1","role":"authenticated"}', true);
do $$
begin
  -- expect: 0 / 0 / 0 / 0
  insert into r(check_name,outcome) values ('S3 chef can read the kitchen tables',
    (select count(*) from public.kitchen_tickets where order_id = (select v::uuid from ctx where k = 'A'))::text
    || ' / ' || (select count(*) from public.kitchen_ticket_lines l join public.kitchen_tickets t on t.id = l.ticket_id
                 where t.order_id = (select v::uuid from ctx where k = 'A'))
    || ' / ' || (select count(*) from public.kitchen_issues i join public.kitchen_tickets t on t.id = i.ticket_id
                 where t.order_id = (select v::uuid from ctx where k = 'A'))
    || ' / ' || (select count(*) from public.order_kitchen_progress where order_id = (select v::uuid from ctx where k = 'A')));
end $$;

-- ===== Ticket building (Task 2) =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}', true);
do $$
declare
  o public.orders;
  a uuid := (select v::uuid from ctx where k = 'A');
  p uuid := (select v::uuid from ctx where k = 'P');
begin
  o := public.confirm_order(a, 1);
  -- expect: confirmed / B-990201-TK1, B-990201-TK2
  insert into r(check_name,outcome) values ('B1 confirming creates one ticket per kitchen',
    o.status::text || ' / ' || (select string_agg(reference, ', ' order by reference) from public.kitchen_tickets where order_id = a));
  -- expect: B-990201-TK1: 2×T Kt Cake (Happy Birthday) {milk} | B-990201-TK2: 3×T Kt Bread {}
  insert into r(check_name,outcome) values ('B2 lines per kitchen; ready-stock left out',
    (select string_agg(t.reference || ': ' || l.quantity || '×' || l.product_name || coalesce(' (' || l.notes || ')', '') || ' ' || l.allergens::text,
                       ' | ' order by t.reference)
     from public.kitchen_tickets t join public.kitchen_ticket_lines l on l.ticket_id = t.id where t.order_id = a));
  -- expect: true / true
  insert into r(check_name,outcome) values ('B3 start by is pickup minus the longest lead time',
    (select string_agg((start_by = due_at - make_interval(mins => case when reference like '%-TK1' then 120 else 60 end))::text, ' / ' order by reference)
     from public.kitchen_tickets where order_id = a));
  -- expect: new r1 null / new r1 null
  insert into r(check_name,outcome) values ('B4 first build is revision 1, not revised',
    (select string_agg(status || ' r' || revision || ' ' || coalesce(revised_at::text, 'null'), ' / ' order by reference)
     from public.kitchen_tickets where order_id = a));
  o := public.confirm_order(p, 1);
  -- expect: confirmed / 0
  insert into r(check_name,outcome) values ('B5 ready-stock-only order gets no ticket',
    o.status::text || ' / ' || (select count(*) from public.kitchen_tickets where order_id = p));
  -- expect: 2 / 0 / false / 0 / 0
  insert into r(check_name,outcome) values ('B6 progress row',
    (select ticket_count || ' / ' || ready_count || ' / ' || all_ready || ' / ' || open_issues || ' / ' || stop_work_pending
     from public.order_kitchen_progress where order_id = a));

  insert into ctx select 'A1', id::text from public.kitchen_tickets where order_id = a and reference like '%-TK1';
  insert into ctx select 'A2', id::text from public.kitchen_tickets where order_id = a and reference like '%-TK2';
  insert into ctx select 'A1cake', l.id::text from public.kitchen_ticket_lines l join public.kitchen_tickets t on t.id = l.ticket_id
    where t.order_id = a and l.product_name = 'T Kt Cake';
  insert into ctx select 'A2bread', l.id::text from public.kitchen_ticket_lines l join public.kitchen_tickets t on t.id = l.ticket_id
    where t.order_id = a and l.product_name = 'T Kt Bread';
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007f1","role":"authenticated"}', true);
do $$
begin
  -- expect: B-990201-TK1 / 0
  insert into r(check_name,outcome) values ('B7 chef one sees only kitchen one, and no orders',
    (select string_agg(reference, ', ') from public.kitchen_tickets where order_id = (select v::uuid from ctx where k = 'A'))
    || ' / ' || (select count(*) from public.orders));
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007f2","role":"authenticated"}', true);
do $$
begin
  -- expect: 2 / 2
  insert into r(check_name,outcome) values ('B8 chef two sees both kitchens',
    (select count(*) from public.kitchen_tickets where order_id = (select v::uuid from ctx where k = 'A'))::text
    || ' / ' || (select count(*) from public.kitchen_ticket_lines l join public.kitchen_tickets t on t.id = l.ticket_id
                 where t.order_id = (select v::uuid from ctx where k = 'A')));
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007c1","role":"authenticated"}', true);
do $$
begin
  -- expect: 2
  insert into r(check_name,outcome) values ('B9 counter staff see every kitchen',
    (select count(*) from public.kitchen_tickets where order_id = (select v::uuid from ctx where k = 'A'))::text);
end $$;

reset role;
select check_name, outcome from r order by n;
rollback;
