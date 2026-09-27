-- Capacity windows, category caps, and overrides (Phase 4C). Runs in a transaction and rolls back.
-- order_number_seq is not transactional: each run consumes order numbers
-- (reset with `alter sequence public.order_number_seq restart with 1001` only while no real orders exist).
-- Expected outcomes are in the comment above each check.
begin;
create temp table r (n serial, check_name text, outcome text) on commit drop;
create temp table ctx (k text primary key, v text) on commit drop;
grant all on r, ctx to authenticated;
grant usage on sequence r_n_seq to authenticated;

-- Local timestamp p_days after today at p_time, in the business timezone.
create function pg_temp.ts(p_days integer, p_time time) returns timestamptz language sql stable as $$
  select (((now() at time zone 'Asia/Kolkata')::date + p_days) + p_time) at time zone 'Asia/Kolkata'
$$;
create function pg_temp.items(p_key text, p_qty integer) returns jsonb language sql stable as $$
  select jsonb_build_array(jsonb_build_object('variant_id', (select v from ctx where k = p_key), 'quantity', p_qty))
$$;

-- Clean, predictable configuration (all rolled back).
delete from public.capacity_overrides;
delete from public.category_daily_caps;
delete from public.pickup_windows;
delete from public.closures;
update public.business_hours set opens_at = '09:00', closes_at = '21:00', is_closed = false;

insert into auth.users (id, email, aud, role) values
 ('00000000-0000-0000-0000-0000000004a1','cap-a@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000004c1','cap-c@t.local','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name, role) values
 ('00000000-0000-0000-0000-0000000004a1','Cap Admin','admin'),
 ('00000000-0000-0000-0000-0000000004c1','Cap Counter','counter');
insert into public.categories (name) values ('T Cap Cakes'), ('T Cap Puffs');
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, 'T Cap Cake', 'ready_stock', 500 from public.categories where name = 'T Cap Cakes';
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, 'T Cap Puff', 'ready_stock', 1800 from public.categories where name = 'T Cap Puffs';
insert into public.product_variants (product_id, name, price_paise)
  select id, 'Each', 50000 from public.products where name = 'T Cap Cake';
insert into public.product_variants (product_id, name, price_paise)
  select id, 'Each', 3000 from public.products where name = 'T Cap Puff';
insert into ctx select 'cake', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Cap Cake';
insert into ctx select 'puff', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Cap Puff';
insert into ctx select 'cakes_cat', id::text from public.categories where name = 'T Cap Cakes';
insert into ctx select 'puffs_cat', id::text from public.categories where name = 'T Cap Puffs';
-- Day 200 ahead has no real orders. Its weekday differs from today's (200 mod 7 = 4) and from day 201's.
insert into ctx values ('day', ((now() at time zone 'Asia/Kolkata')::date + 200)::text);
insert into ctx values ('dow', extract(dow from (now() at time zone 'Asia/Kolkata')::date + 200)::text);
insert into ctx values ('today_dow', extract(dow from (now() at time zone 'Asia/Kolkata')::date)::text);

set local role authenticated;

-- ===== Admin: settings =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000004a1","role":"authenticated"}', true);
do $$
declare dow smallint := (select v::smallint from ctx where k = 'dow');
begin
  perform public.set_pickup_windows(array[dow],
    '[{"starts_at":"09:00","ends_at":"11:00","max_orders":2},{"starts_at":"11:00","ends_at":"13:00","max_orders":null}]');
  -- expect: 2
  insert into r(check_name,outcome) values ('A1 admin sets weekday windows', (select count(*) from public.pickup_windows where weekday = dow)::text);

  begin perform public.set_pickup_windows(array[dow], '[{"starts_at":"09:00","ends_at":"11:00"},{"starts_at":"10:00","ends_at":"12:00"}]');
    insert into r(check_name,outcome) values ('A2 overlapping windows refused', 'ALLOWED');
  -- expect: Pickup windows on the same day cannot overlap (…)
  exception when others then insert into r(check_name,outcome) values ('A2 overlapping windows refused', sqlerrm); end;

  begin perform public.set_pickup_windows(array[dow], '[{"starts_at":"12:00","ends_at":"11:00"}]');
    insert into r(check_name,outcome) values ('A3 window ending before start refused', 'ALLOWED');
  -- expect: Each window must end after it starts.
  exception when others then insert into r(check_name,outcome) values ('A3 window ending before start refused', sqlerrm); end;

  -- expect: 2 (failed saves left the earlier list intact)
  insert into r(check_name,outcome) values ('A4 failed saves keep previous windows', (select count(*) from public.pickup_windows where weekday = dow)::text);

  -- Today's weekday: one all-day window with no places, to prove walk-ins skip capacity (C9).
  perform public.set_pickup_windows(array[(select v::smallint from ctx where k = 'today_dow')],
    '[{"starts_at":"00:00","ends_at":"23:59","max_orders":0}]');
  insert into public.category_daily_caps (category_id, max_orders) values ((select v::uuid from ctx where k = 'cakes_cat'), 1);

  begin perform public.set_date_windows((now() at time zone 'Asia/Kolkata')::date - 1, 'Past', '[{"starts_at":"09:00","ends_at":"10:00"}]');
    insert into r(check_name,outcome) values ('A5 date override in the past refused', 'ALLOWED');
  -- expect: Choose today or a later date.
  exception when others then insert into r(check_name,outcome) values ('A5 date override in the past refused', sqlerrm); end;
end $$;

-- ===== Counter: settings are admin-only =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000004c1","role":"authenticated"}', true);
do $$ begin
  begin perform public.set_pickup_windows(array[1::smallint], '[]');
    insert into r(check_name,outcome) values ('E1 counter cannot change windows', 'ALLOWED');
  -- expect: Only an admin can change pickup windows.
  exception when others then insert into r(check_name,outcome) values ('E1 counter cannot change windows', sqlerrm); end;

  begin insert into public.category_daily_caps (category_id, max_orders) values ((select v::uuid from ctx where k = 'puffs_cat'), 3);
    insert into r(check_name,outcome) values ('E2 counter cannot set caps', 'ALLOWED');
  -- expect: new row violates row-level security policy …
  exception when others then insert into r(check_name,outcome) values ('E2 counter cannot set caps', sqlerrm); end;
end $$;

-- ORDER CHECKS (added in Task 2) GO HERE

reset role;
select check_name, outcome from r order by n;
rollback;
