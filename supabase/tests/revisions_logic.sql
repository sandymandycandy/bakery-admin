-- Kitchen revisions after acknowledgement (Phase 5C). Runs in a transaction and rolls back.
-- Orders are inserted directly with order numbers from 990401, so order_number_seq is not consumed.
-- Expected outcomes are in the comment above each check.
begin;
create temp table r (n serial, check_name text, outcome text) on commit drop;
create temp table ctx (k text primary key, v text) on commit drop;
grant all on r, ctx to authenticated;
grant usage on sequence r_n_seq to authenticated;

insert into auth.users (id, email, aud, role) values
 ('00000000-0000-0000-0000-0000000009a1','rv-a@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000009c1','rv-c@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000009f1','rv-f1@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000009f2','rv-f2@t.local','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name, role) values
 ('00000000-0000-0000-0000-0000000009a1','Rv Admin','admin'),
 ('00000000-0000-0000-0000-0000000009c1','Rv Counter','counter'),
 ('00000000-0000-0000-0000-0000000009f1','Rv Chef One','chef'),
 ('00000000-0000-0000-0000-0000000009f2','Rv Chef Two','chef');
insert into public.kitchens (code, name) values ('TR1', 'T Rv Kitchen One'), ('TR2', 'T Rv Kitchen Two');
insert into public.staff_kitchens (user_id, kitchen_id)
  select '00000000-0000-0000-0000-0000000009f1'::uuid, id from public.kitchens where code = 'TR1';
insert into public.staff_kitchens (user_id, kitchen_id)
  select '00000000-0000-0000-0000-0000000009f2'::uuid, id from public.kitchens where code = 'TR2';

-- Predictable scheduling rules (all rolled back).
delete from public.capacity_overrides;
delete from public.category_daily_caps;
delete from public.pickup_windows;
delete from public.closures;
update public.business_hours set opens_at = '09:00', closes_at = '21:00', is_closed = false;

insert into public.categories (name) values ('T Rv Bakes');
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, x.name, 'made_to_order', 500 from public.categories, (values ('T Rv Cake'), ('T Rv Bread'), ('T Rv Cookie')) x(name)
  where categories.name = 'T Rv Bakes';
insert into public.product_variants (product_id, name, price_paise, lead_time_minutes, kitchen_id)
  select p.id, '1 kg', 50000, 60, k.id from public.products p, public.kitchens k where p.name = 'T Rv Cake' and k.code = 'TR1';
insert into public.product_variants (product_id, name, price_paise, lead_time_minutes, kitchen_id)
  select p.id, 'Loaf', 8000, 60, k.id from public.products p, public.kitchens k where p.name = 'T Rv Bread' and k.code = 'TR2';
insert into public.product_variants (product_id, name, price_paise, lead_time_minutes, kitchen_id)
  select p.id, 'Each', 2000, 30, k.id from public.products p, public.kitchens k where p.name = 'T Rv Cookie' and k.code = 'TR1';
insert into ctx select 'cake', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Rv Cake';
insert into ctx select 'bread', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Rv Bread';
insert into ctx select 'cookie', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Rv Cookie';

-- Review fix: a capped category (T Rv Tarts, at most 1 order a day) for V27.
insert into public.categories (name) values ('T Rv Tarts');
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, 'T Rv Tart', 'made_to_order', 500 from public.categories where name = 'T Rv Tarts';
insert into public.product_variants (product_id, name, price_paise, lead_time_minutes, kitchen_id)
  select p.id, 'Each', 3000, 30, k.id from public.products p, public.kitchens k where p.name = 'T Rv Tart' and k.code = 'TR1';
insert into ctx select 'tart', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Rv Tart';
insert into public.category_daily_caps (category_id, max_orders) select id, 1 from public.categories where name = 'T Rv Tarts';

-- Noon on day p_days after today, business time.
create function pg_temp.day(p_days integer) returns timestamptz language sql stable as $$
  select (((now() at time zone 'Asia/Kolkata')::date + p_days) + time '12:00') at time zone 'Asia/Kolkata'
$$;
create function pg_temp.mk_order(p_num bigint, p_due timestamptz) returns uuid language sql as $$
  insert into public.orders (order_number, idempotency_key, source, status, customer_name, customer_phone, requested_due_at)
  values (p_num, gen_random_uuid(), 'CALL', 'pending_confirmation', 'Rv Customer', '9000000901', p_due)
  returning id
$$;
create function pg_temp.mk_line(p_order uuid, p_key text, p_qty integer) returns uuid language sql as $$
  insert into public.order_items (
    order_id, line_no, product_id, variant_id, category_id, product_name, variant_name, prep_type, kitchen_id,
    is_veg, contains_egg, is_eggless, allergens, lead_time_minutes, unit_price_paise, tax_rate_bps,
    quantity, line_total_paise, tax_paise)
  select p_order, coalesce((select max(line_no) from public.order_items where order_id = p_order), 0) + 1,
         p.id, pv.id, p.category_id, p.name, pv.name, p.prep_type, pv.kitchen_id,
         p.is_veg, p.contains_egg, pv.is_eggless, p.allergens, pv.lead_time_minutes, pv.price_paise, p.tax_rate_bps,
         p_qty, pv.price_paise * p_qty, 0
  from public.product_variants pv join public.products p on p.id = pv.product_id
  where pv.id = (select v::uuid from ctx where k = p_key)
  returning id
$$;
-- "status rN / Product ready/quantity status, ..." for one kitchen's ticket of an order.
create function pg_temp.tk(p_order uuid, p_code text) returns text language sql stable as $$
  select t.status || ' r' || t.revision || ' / ' ||
    coalesce((select string_agg(l.product_name || ' ' || l.ready_quantity || '/' || l.quantity || ' ' || l.status, ', ' order by l.line_no)
              from public.kitchen_ticket_lines l where l.ticket_id = t.id), '')
  from public.kitchen_tickets t join public.kitchens k on k.id = t.kitchen_id
  where t.order_id = p_order and k.code = p_code
$$;
-- "Item:from>to, ..." for one kitchen's pending changes.
create function pg_temp.pending(p_order uuid, p_code text) returns text language sql stable as $$
  select coalesce(string_agg((x.e ->> 'item') || ':' || coalesce(x.e ->> 'from', '') || '>' || coalesce(x.e ->> 'to', ''), ', ' order by x.n), '')
  from public.kitchen_tickets t
  join public.kitchens k on k.id = t.kitchen_id
  cross join lateral jsonb_array_elements(t.pending_changes) with ordinality as x(e, n)
  where t.order_id = p_order and k.code = p_code
$$;
create function pg_temp.ver(p_order uuid) returns integer language sql stable as $$
  select version from public.orders where id = p_order
$$;
create function pg_temp.line(p_order uuid, p_product text) returns text language sql stable as $$
  select id::text from public.order_items where order_id = p_order and product_name = p_product
$$;
create function pg_temp.tline(p_order uuid, p_product text) returns uuid language sql stable as $$
  select l.id from public.kitchen_ticket_lines l join public.kitchen_tickets t on t.id = l.ticket_id
  where t.order_id = p_order and l.product_name = p_product
$$;
create function pg_temp.ticket(p_order uuid, p_code text) returns uuid language sql stable as $$
  select t.id from public.kitchen_tickets t join public.kitchens k on k.id = t.kitchen_id
  where t.order_id = p_order and k.code = p_code
$$;

-- A: cake ×2 (TR1) + bread ×3 (TR2) · B: cake ×1 + bread ×1 · C: cake ×1
insert into ctx values ('A', pg_temp.mk_order(990401, pg_temp.day(3))::text);
insert into ctx values ('B', pg_temp.mk_order(990402, pg_temp.day(3))::text);
insert into ctx values ('C', pg_temp.mk_order(990403, pg_temp.day(3))::text);
select pg_temp.mk_line((select v::uuid from ctx where k = 'A'), 'cake', 2);
select pg_temp.mk_line((select v::uuid from ctx where k = 'A'), 'bread', 3);
select pg_temp.mk_line((select v::uuid from ctx where k = 'B'), 'cake', 1);
select pg_temp.mk_line((select v::uuid from ctx where k = 'B'), 'bread', 1);
select pg_temp.mk_line((select v::uuid from ctx where k = 'C'), 'cake', 1);
-- D: cake ×1 + tart ×1 · E: tart ×1 (both on day 6, for V27/V28)
insert into ctx values ('D', pg_temp.mk_order(990404, pg_temp.day(6))::text);
insert into ctx values ('E', pg_temp.mk_order(990405, pg_temp.day(6))::text);
-- F: cake ×2 (V31)
insert into ctx values ('F', pg_temp.mk_order(990406, pg_temp.day(3))::text);
select pg_temp.mk_line((select v::uuid from ctx where k = 'F'), 'cake', 2);
select pg_temp.mk_line((select v::uuid from ctx where k = 'D'), 'cake', 1);
select pg_temp.mk_line((select v::uuid from ctx where k = 'D'), 'tart', 1);
select pg_temp.mk_line((select v::uuid from ctx where k = 'E'), 'tart', 1);
select private.recalc_order_totals(v::uuid) from ctx where k in ('A', 'B', 'C', 'D', 'E', 'F');

set local role authenticated;

-- Admin confirms everything.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);
do $$ begin perform public.confirm_order(v::uuid, 1) from ctx where k in ('A', 'B', 'C'); end $$;
insert into ctx select o.k || '-' || kc.code, t.id::text
  from ctx o join public.kitchen_tickets t on t.order_id = o.v::uuid join public.kitchens kc on kc.id = t.kitchen_id
  where o.k in ('A', 'B', 'C');

-- Chef One starts A's cakes and finishes both; Chef Two acknowledges A's bread and starts B's bread.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009f1","role":"authenticated"}', true);
do $$
declare a uuid := (select v::uuid from ctx where k = 'A');
begin
  perform public.start_ticket(pg_temp.ticket(a, 'TR1'));
  perform public.set_line_ready(pg_temp.tline(a, 'T Rv Cake'), 2);
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009f2","role":"authenticated"}', true);
do $$
begin
  perform public.acknowledge_ticket(pg_temp.ticket((select v::uuid from ctx where k = 'A'), 'TR2'));
  perform public.start_ticket(pg_temp.ticket((select v::uuid from ctx where k = 'B'), 'TR2'));
end $$;

-- ===== Who may change a preparing order =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009c1","role":"authenticated"}', true);
do $$
declare h text; a uuid := (select v::uuid from ctx where k = 'A');
begin
  begin perform public.update_order_items(a, pg_temp.ver(a), jsonb_build_array(
          jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Cake'), 'quantity', 3),
          jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Bread'), 'quantity', 3)), 'More cake');
    insert into r(check_name,outcome) values ('V1 counter staff cannot change a preparing order', 'ALLOWED');
  -- expect: forbidden: Only an admin can change the items on a confirmed order.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('V1 counter staff cannot change a preparing order', h || ': ' || sqlerrm); end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);
do $$
declare h text; a uuid := (select v::uuid from ctx where k = 'A');
begin
  begin perform public.update_order_items(a, pg_temp.ver(a), jsonb_build_array(
          jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Cake'), 'quantity', 3),
          jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Bread'), 'quantity', 3)));
    insert into r(check_name,outcome) values ('V2 a reason is required', 'ALLOWED');
  -- expect: validation: Give a reason for changing a confirmed order.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('V2 a reason is required', h || ': ' || sqlerrm); end;

  -- ===== Revising acknowledged and started tickets =====
  perform public.update_order_items(a, pg_temp.ver(a), jsonb_build_array(
    jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Cake'), 'quantity', 3),
    jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Bread'), 'quantity', 1),
    jsonb_build_object('variant_id', (select v from ctx where k = 'cookie'), 'quantity', 4)), 'Customer called');
  -- expect: preparing r2 / T Rv Cake 2/3 preparing, T Rv Cookie 0/4 preparing
  insert into r(check_name,outcome) values ('V3 a Ready started ticket keeps its counts and drops to Preparing', pg_temp.tk(a, 'TR1'));
  -- expect: acknowledged r2 / T Rv Bread 0/1 pending
  insert into r(check_name,outcome) values ('V4 an acknowledged ticket is revised in place', pg_temp.tk(a, 'TR2'));
  -- expect: T Rv Cake — 1 kg:2>3, T Rv Cookie — Each:0>4 | T Rv Bread — Loaf:3>1
  insert into r(check_name,outcome) values ('V5 each kitchen gets its exact change list', pg_temp.pending(a, 'TR1') || ' | ' || pg_temp.pending(a, 'TR2'));
  -- expect: preparing / 2 / true
  insert into r(check_name,outcome) values ('V6 the order stays Preparing and the timeline lists both tickets',
    (select status::text from public.orders where id = a) || ' / '
    || (select jsonb_array_length(data -> 'tickets') from public.order_events where order_id = a and event_type = 'tickets_revised' order by id desc limit 1)
    || ' / ' || (select (count(*) = 2)::text from public.kitchen_tickets where order_id = a and has_pending_changes));
end $$;

-- Chef Two finishes the bread (TR2 becomes Ready).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009f2","role":"authenticated"}', true);
do $$ begin perform public.set_line_ready(pg_temp.tline((select v::uuid from ctx where k = 'A'), 'T Rv Bread'), 1); end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);
do $$
declare a uuid := (select v::uuid from ctx where k = 'A');
begin
  perform public.update_order_items(a, pg_temp.ver(a), jsonb_build_array(
    jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Cake'), 'quantity', 1),
    jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Bread'), 'quantity', 1),
    jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Cookie'), 'quantity', 4)), 'Only one cake after all');
  -- expect: preparing r3 / T Rv Cake 1/1 ready, T Rv Cookie 0/4 preparing / T Rv Cake — 1 kg:2>1, T Rv Cookie — Each:0>4
  insert into r(check_name,outcome) values ('V7 lowering below the ready count caps it; changes merge from the last acknowledged state',
    pg_temp.tk(a, 'TR1') || ' / ' || pg_temp.pending(a, 'TR1'));

  perform public.update_order_items(a, pg_temp.ver(a), jsonb_build_array(
    jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Cake'), 'quantity', 2),
    jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Bread'), 'quantity', 1),
    jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Cookie'), 'quantity', 4)), 'Two cakes again');
  -- expect: preparing r4 / T Rv Cake 1/2 preparing, T Rv Cookie 0/4 preparing / T Rv Cookie — Each:0>4
  insert into r(check_name,outcome) values ('V8 a change back to the acknowledged quantity leaves the list',
    pg_temp.tk(a, 'TR1') || ' / ' || pg_temp.pending(a, 'TR1'));
end $$;

-- ===== Acknowledging changes =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009f1","role":"authenticated"}', true);
do $$
declare t public.kitchen_tickets; a uuid := (select v::uuid from ctx where k = 'A');
begin
  t := public.acknowledge_ticket_changes(pg_temp.ticket(a, 'TR1'));
  -- expect: 0 / true / preparing
  insert into r(check_name,outcome) values ('V9 the chef acknowledges: the list clears and work continues',
    jsonb_array_length(t.pending_changes) || ' / ' || (t.changes_acknowledged_at is not null)::text || ' / ' || t.status);
  t := public.acknowledge_ticket_changes(pg_temp.ticket(a, 'TR1'));
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009f2","role":"authenticated"}', true);
do $$
declare h text;
begin
  begin perform public.acknowledge_ticket_changes((select v::uuid from ctx where k = 'A-TR1'));
    insert into r(check_name,outcome) values ('V11 a chef of another kitchen cannot acknowledge', 'ALLOWED');
  -- expect: forbidden: This ticket belongs to a kitchen you are not assigned to.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('V11 a chef of another kitchen cannot acknowledge', h || ': ' || sqlerrm); end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);
do $$
declare h text;
begin
  -- expect: 1
  insert into r(check_name,outcome) values ('V10 the timeline records one acknowledgement although the chef tapped twice',
    (select count(*) from public.order_events where order_id = (select v::uuid from ctx where k = 'A') and event_type = 'ticket_changes_acknowledged')::text);
  begin perform public.acknowledge_ticket_changes(pg_temp.ticket((select v::uuid from ctx where k = 'A'), 'TR2'));
    insert into r(check_name,outcome) values ('V12 an admin needs a reason', 'ALLOWED');
  -- expect: forbidden: Give a reason of at least 5 characters for acting on a kitchen ticket.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('V12 an admin needs a reason', h || ': ' || sqlerrm); end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009c1","role":"authenticated"}', true);
do $$
declare h text;
begin
  begin perform public.acknowledge_ticket_changes(pg_temp.ticket((select v::uuid from ctx where k = 'A'), 'TR2'), 'Told the kitchen');
    insert into r(check_name,outcome) values ('V13 counter staff cannot acknowledge', 'ALLOWED');
  -- expect: forbidden: Only the kitchen can update tickets.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('V13 counter staff cannot acknowledge', h || ': ' || sqlerrm); end;
end $$;

-- ===== Removing items =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);
do $$
declare a uuid := (select v::uuid from ctx where k = 'A');
begin
  perform public.update_order_items(a, pg_temp.ver(a), jsonb_build_array(
    jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Cake'), 'quantity', 2),
    jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Bread'), 'quantity', 1)), 'No cookies');
  -- expect: q4 c4 t0 / 108000 / preparing r5 / T Rv Cake 1/2 preparing, T Rv Cookie 0/0 cancelled / T Rv Cookie — Each:4>0
  insert into r(check_name,outcome) values ('V14 a removed item is kept as cancelled, out of the total, and shown to the kitchen',
    (select 'q' || quantity || ' c' || cancelled_quantity || ' t' || line_total_paise from public.order_items where order_id = a and product_name = 'T Rv Cookie')
    || ' / ' || (select total_paise from public.orders where id = a)
    || ' / ' || pg_temp.tk(a, 'TR1') || ' / ' || pg_temp.pending(a, 'TR1'));
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009f1","role":"authenticated"}', true);
do $$
declare h text;
begin
  begin perform public.set_line_ready(pg_temp.tline((select v::uuid from ctx where k = 'A'), 'T Rv Cookie'), 0);
    insert into r(check_name,outcome) values ('V15 no ready count on a removed item', 'ALLOWED');
  -- expect: validation: This item was removed from the order.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('V15 no ready count on a removed item', h || ': ' || sqlerrm); end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);
do $$
declare h text; a uuid := (select v::uuid from ctx where k = 'A');
begin
  begin perform public.update_order_items(a, pg_temp.ver(a), jsonb_build_array(
          jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Cake'), 'quantity', 2),
          jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Bread'), 'quantity', 1),
          jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Cookie'), 'quantity', 2)), 'Cookies back');
    insert into r(check_name,outcome) values ('V16 a removed line cannot be brought back by its id', 'ALLOWED');
  -- expect: validation: Line 3 was removed from this order. Add the item again instead.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('V16 a removed line cannot be brought back by its id', h || ': ' || sqlerrm); end;

  -- B: Chef Two has started the bread; removing it stops that kitchen's work.
  perform public.update_order_items((select v::uuid from ctx where k = 'B'), pg_temp.ver((select v::uuid from ctx where k = 'B')),
    jsonb_build_array(jsonb_build_object('line_id', pg_temp.line((select v::uuid from ctx where k = 'B'), 'T Rv Cake'), 'quantity', 1)), 'No bread');
  -- expect: cancelled / Removed from the order / 1 / q1 c1
  insert into r(check_name,outcome) values ('V23 removing every item of a started kitchen raises stop-work and keeps the line',
    (select t.status || ' / ' || t.cancel_reason from public.kitchen_tickets t where t.id = pg_temp.ticket((select v::uuid from ctx where k = 'B'), 'TR2'))
    || ' / ' || (select stop_work_pending from public.order_kitchen_progress where order_id = (select v::uuid from ctx where k = 'B'))
    || ' / ' || (select 'q' || quantity || ' c' || cancelled_quantity from public.order_items
                 where order_id = (select v::uuid from ctx where k = 'B') and product_name = 'T Rv Bread'));

  -- C: nobody has acknowledged; the ticket is rebuilt as in 5A, with no change list.
  perform public.update_order_items((select v::uuid from ctx where k = 'C'), pg_temp.ver((select v::uuid from ctx where k = 'C')),
    jsonb_build_array(jsonb_build_object('line_id', pg_temp.line((select v::uuid from ctx where k = 'C'), 'T Rv Cake'), 'quantity', 2)), 'Two cakes');
  -- expect: new r2 / T Rv Cake 0/2 pending / 0
  insert into r(check_name,outcome) values ('V24 a ticket still New is rebuilt without a change list',
    pg_temp.tk((select v::uuid from ctx where k = 'C'), 'TR1') || ' / '
    || (select jsonb_array_length(pending_changes) from public.kitchen_tickets where id = pg_temp.ticket((select v::uuid from ctx where k = 'C'), 'TR1')));
end $$;

-- ===== Packing, reschedules and bills (Task 2) =====
-- Both kitchens finish A (TR1 is Ready although its cookie line is cancelled).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009f1","role":"authenticated"}', true);
do $$
declare a uuid := (select v::uuid from ctx where k = 'A');
begin
  perform public.set_line_ready(pg_temp.tline(a, 'T Rv Cake'), 2);
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);
do $$
declare a uuid := (select v::uuid from ctx where k = 'A');
begin
  -- expect: ready r5 / T Rv Cake 2/2 ready, T Rv Cookie 0/0 cancelled / ready r2
  insert into r(check_name,outcome) values ('V17 removed lines do not hold a ticket back from Ready',
    pg_temp.tk(a, 'TR1') || ' / ' || split_part(pg_temp.tk(a, 'TR2'), ' / ', 1));
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009c1","role":"authenticated"}', true);
do $$
declare h text; a uuid := (select v::uuid from ctx where k = 'A');
begin
  begin perform public.mark_packed(a, pg_temp.ver(a));
    insert into r(check_name,outcome) values ('V18 packing waits for every kitchen to acknowledge', 'ALLOWED');
  -- expect: kitchen: Not every kitchen has acknowledged the latest change: T Rv Kitchen One, T Rv Kitchen Two.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('V18 packing waits for every kitchen to acknowledge', h || ': ' || sqlerrm); end;
  -- expect: 2
  insert into r(check_name,outcome) values ('V19 the progress view counts unacknowledged tickets',
    (select changes_pending from public.order_kitchen_progress where order_id = a)::text);
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009f1","role":"authenticated"}', true);
do $$ begin perform public.acknowledge_ticket_changes(pg_temp.ticket((select v::uuid from ctx where k = 'A'), 'TR1')); end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009f2","role":"authenticated"}', true);
do $$ begin perform public.acknowledge_ticket_changes(pg_temp.ticket((select v::uuid from ctx where k = 'A'), 'TR2')); end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009c1","role":"authenticated"}', true);
do $$
declare o public.orders; a uuid := (select v::uuid from ctx where k = 'A');
begin
  o := public.mark_packed(a, pg_temp.ver(a));
  -- expect: ready
  insert into r(check_name,outcome) values ('V20 packed once every change is acknowledged', o.status::text);
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);
do $$
declare h text; a uuid := (select v::uuid from ctx where k = 'A');
begin
  begin perform public.update_order_items(a, pg_temp.ver(a), jsonb_build_array(
          jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Cake'), 'quantity', 3),
          jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Bread'), 'quantity', 1)), 'One more cake');
    insert into r(check_name,outcome) values ('V21 a packed order must be reopened before an edit', 'ALLOWED');
  -- expect: kitchen: This order is packed. Reopen packing before changing its items.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('V21 a packed order must be reopened before an edit', h || ': ' || sqlerrm); end;
  begin perform public.reschedule_order(a, pg_temp.ver(a), pg_temp.day(4), 'Customer asked');
    insert into r(check_name,outcome) values ('V22 a packed order must be reopened before a reschedule', 'ALLOWED');
  -- expect: kitchen: This order is packed. Reopen packing before changing its pickup time.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('V22 a packed order must be reopened before a reschedule', h || ': ' || sqlerrm); end;

  perform public.reopen_packing(a, pg_temp.ver(a), 'Customer moved the pickup');
  perform public.reschedule_order(a, pg_temp.ver(a), pg_temp.day(4), 'Customer asked');
  -- expect: ready, ready / 2 / 2 / preparing
  insert into r(check_name,outcome) values ('V25 rescheduling a preparing order adds a pickup change to each ticket',
    (select string_agg(status::text, ', ' order by reference) from public.kitchen_tickets where order_id = a and status <> 'cancelled')
    || ' / ' || (select count(*) from public.kitchen_tickets t where t.order_id = a
                 and exists (select 1 from jsonb_array_elements(t.pending_changes) e where e ->> 'kind' = 'pickup'))
    || ' / ' || (select count(*) from public.kitchen_tickets where order_id = a and due_at = pg_temp.day(4))
    || ' / ' || (select status::text from public.orders where id = a));
end $$;

-- Acknowledge, pack, pay, hand over: the bill leaves out the removed cookies.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009f1","role":"authenticated"}', true);
do $$ begin perform public.acknowledge_ticket_changes(pg_temp.ticket((select v::uuid from ctx where k = 'A'), 'TR1')); end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009f2","role":"authenticated"}', true);
do $$ begin perform public.acknowledge_ticket_changes(pg_temp.ticket((select v::uuid from ctx where k = 'A'), 'TR2')); end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009c1","role":"authenticated"}', true);
do $$
declare a uuid := (select v::uuid from ctx where k = 'A');
begin
  perform public.mark_packed(a, pg_temp.ver(a));
  perform public.record_payment(a, gen_random_uuid(), 'payment', 'upi', (select total_paise from public.orders where id = a));
  perform public.record_handover(a, pg_temp.ver(a));
  -- expect: T Rv Cake ×2, T Rv Bread ×1 / 108000
  insert into r(check_name,outcome) values ('V26 the bill leaves out removed items',
    (select string_agg((e ->> 'name') || ' ×' || (e ->> 'quantity'), ', ' order by (e ->> 'line_no')::integer)
     from public.bills b, jsonb_array_elements(b.lines) e where b.order_id = a)
    || ' / ' || (select total_paise from public.bills where order_id = a));
end $$;

-- ===== Review fixes =====
-- V27: a removed (cancelled) line must not count as "already on the order" for category caps.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);
do $$
declare d uuid := (select v::uuid from ctx where k = 'D');
begin
  perform public.confirm_order(d, 1);
  insert into ctx select 'D-TR1', t.id::text from public.kitchen_tickets t where t.order_id = d;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009f1","role":"authenticated"}', true);
do $$ begin perform public.acknowledge_ticket((select v::uuid from ctx where k = 'D-TR1')); end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);
do $$
declare h text; d uuid := (select v::uuid from ctx where k = 'D');
begin
  perform public.update_order_items(d, pg_temp.ver(d), jsonb_build_array(
    jsonb_build_object('line_id', pg_temp.line(d, 'T Rv Cake'), 'quantity', 1)), 'No tart');
  perform public.confirm_order((select v::uuid from ctx where k = 'E'), 1);
  begin perform public.update_order_items(d, pg_temp.ver(d), jsonb_build_array(
          jsonb_build_object('line_id', pg_temp.line(d, 'T Rv Cake'), 'quantity', 1),
          jsonb_build_object('variant_id', (select v from ctx where k = 'tart'), 'quantity', 1)), 'Tart after all');
    insert into r(check_name,outcome) values ('V27 re-adding a removed item checks the category cap again', 'ALLOWED');
  -- expect: capacity: T Rv Tarts: 1/1 orders on <DD Mon>. An admin can override with a reason.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('V27 re-adding a removed item checks the category cap again', h || ': ' || sqlerrm); end;
end $$;

-- V28: the kitchen acknowledges the revision it was shown, not a newer one.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009f1","role":"authenticated"}', true);
do $$
declare h text; t public.kitchen_tickets; tk uuid := (select v::uuid from ctx where k = 'D-TR1');
begin
  begin perform public.acknowledge_ticket_changes(tk, null, 1);
    insert into r(check_name,outcome) values ('V28 acknowledging an older revision is refused', 'ALLOWED');
  -- expect: conflict: The order changed again. Check the new list of changes, then acknowledge.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('V28 acknowledging an older revision is refused', h || ': ' || sqlerrm); end;
  t := public.acknowledge_ticket_changes(tk, null, 2);
  -- expect: r2 / 0
  insert into r(check_name,outcome) values ('V29 acknowledging the revision shown clears the list',
    'r' || t.revision || ' / ' || jsonb_array_length(t.pending_changes));
end $$;

-- ===== Deferred review minors =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);
do $$
declare d uuid := (select v::uuid from ctx where k = 'D');
begin
  -- expect: 1
  insert into r(check_name,outcome) values ('V30 a removed item no longer lists its kitchen on the order',
    (select cardinality(kitchen_ids) from public.order_summaries where id = (select v::uuid from ctx where k = 'B'))::text);

  -- Add cookies to D (acknowledged), then take them off again before the kitchen acknowledges.
  perform public.update_order_items(d, pg_temp.ver(d), jsonb_build_array(
    jsonb_build_object('line_id', pg_temp.line(d, 'T Rv Cake'), 'quantity', 1),
    jsonb_build_object('variant_id', (select v from ctx where k = 'cookie'), 'quantity', 6)), 'Cookies');
  perform public.update_order_items(d, pg_temp.ver(d), jsonb_build_array(
    jsonb_build_object('line_id', pg_temp.line(d, 'T Rv Cake'), 'quantity', 1)), 'No cookies after all');
  -- expect: acknowledged r4 / T Rv Cake 0/1 pending, T Rv Tart 0/0 cancelled /
  insert into r(check_name,outcome) values ('V32 an item added and removed before acknowledgement leaves no trace on the ticket',
    pg_temp.tk(d, 'TR1') || ' / ' || pg_temp.pending(d, 'TR1'));

  -- Move D's pickup in UTC, then back in India time: the change list nets out.
  set local timezone = 'UTC';
  perform public.reschedule_order(d, pg_temp.ver(d), pg_temp.day(6) + interval '1 hour', 'Later');
  set local timezone = 'Asia/Kolkata';
  perform public.reschedule_order(d, pg_temp.ver(d), pg_temp.day(6), 'Back to noon');
  -- expect:
  insert into r(check_name,outcome) values ('V34 a pickup moved and moved back nets out whatever the session time zone',
    pg_temp.pending(d, 'TR1'));

  perform public.confirm_order((select v::uuid from ctx where k = 'F'), 1);
  insert into ctx select 'F-TR1', t.id::text from public.kitchen_tickets t where t.order_id = (select v::uuid from ctx where k = 'F');
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009f1","role":"authenticated"}', true);
do $$
declare h text; d uuid := (select v::uuid from ctx where k = 'D');
begin
  perform public.set_line_ready(pg_temp.tline((select v::uuid from ctx where k = 'F'), 'T Rv Cake'), 1);
  begin perform public.report_issue((select v::uuid from ctx where k = 'D-TR1'), 'quality', 'Tart cracked', pg_temp.tline(d, 'T Rv Tart'));
    insert into r(check_name,outcome) values ('V33 no issue can be reported on a removed item', 'ALLOWED');
  -- expect: validation: This item was removed from the order.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('V33 no issue can be reported on a removed item', h || ': ' || sqlerrm); end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);
do $$
declare f uuid := (select v::uuid from ctx where k = 'F');
begin
  -- One of two cakes is made; the customer now wants one, so the ticket becomes Ready through the edit.
  perform public.update_order_items(f, pg_temp.ver(f), jsonb_build_array(
    jsonb_build_object('line_id', pg_temp.line(f, 'T Rv Cake'), 'quantity', 1)), 'Only one cake');
  -- expect: ready r2 / Order changed: everything left was already made.
  insert into r(check_name,outcome) values ('V31 a ticket made Ready by an edit says so in the timeline',
    split_part(pg_temp.tk(f, 'TR1'), ' / ', 1) || ' / '
    || (select reason from public.order_events where order_id = f and event_type = 'ticket_ready'));
end $$;

reset role;
select check_name, outcome from r order by n;
rollback;
