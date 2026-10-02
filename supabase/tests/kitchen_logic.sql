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

-- ===== Chef actions and issues (Task 3) =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007f1","role":"authenticated"}', true);
do $$
declare
  t public.kitchen_tickets; t2 public.kitchen_tickets; h text; n integer;
  a1 uuid := (select v::uuid from ctx where k = 'A1');
  a2 uuid := (select v::uuid from ctx where k = 'A2');
  cake uuid := (select v::uuid from ctx where k = 'A1cake');
begin
  t := public.acknowledge_ticket(a1);
  t2 := public.acknowledge_ticket(a1);
  -- expect: acknowledged / true
  insert into r(check_name,outcome) values ('C1 acknowledging twice changes nothing',
    t2.status::text || ' / ' || (t2.acknowledged_at = t.acknowledged_at)::text);

  begin perform public.start_ticket(a2);
    insert into r(check_name,outcome) values ('C2 chef cannot act on another kitchen', 'ALLOWED');
  -- expect: forbidden: This ticket belongs to a kitchen you are not assigned to.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('C2 chef cannot act on another kitchen', h || ': ' || sqlerrm); end;

  t := public.set_line_ready(cake, 1);
  -- expect: preparing / preparing
  insert into r(check_name,outcome) values ('C3 part ready starts the ticket',
    (select status::text from public.kitchen_ticket_lines where id = cake) || ' / ' || t.status);
  t := public.set_line_ready(cake, 2);
  -- expect: ready / ready
  insert into r(check_name,outcome) values ('C4 full count makes line and ticket ready',
    (select status::text from public.kitchen_ticket_lines where id = cake) || ' / ' || t.status);
  t := public.set_line_ready(cake, 1);
  -- expect: preparing / preparing / null
  insert into r(check_name,outcome) values ('C5 lowering the count drops back to preparing',
    (select status::text from public.kitchen_ticket_lines where id = cake) || ' / ' || t.status || ' / ' || coalesce(t.ready_at::text, 'null'));

  begin perform public.set_line_ready(cake, 5);
    insert into r(check_name,outcome) values ('C6 ready count above the quantity refused', 'ALLOWED');
  -- expect: validation: Enter a ready count from 0 to 2.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('C6 ready count above the quantity refused', h || ': ' || sqlerrm); end;
  t2 := public.set_line_ready(cake, 1);
  -- expect: true
  insert into r(check_name,outcome) values ('C6b same count again changes nothing', (t2.updated_at = t.updated_at)::text);

  perform public.report_issue(a1, 'ingredient', ' Out of cream ', cake);
  begin perform public.report_issue(a1, 'other', 'x');
    insert into r(check_name,outcome) values ('C7 issue note too short', 'ALLOWED');
  -- expect: validation: Describe the issue in at least 3 characters.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('C7 issue note too short', h || ': ' || sqlerrm); end;
  begin perform public.resolve_issue((select id from public.kitchen_issues where ticket_id = a1), 'Fixed it');
    insert into r(check_name,outcome) values ('C8 chef cannot resolve issues', 'ALLOWED');
  -- expect: forbidden: Only an admin can resolve kitchen issues.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('C8 chef cannot resolve issues', h || ': ' || sqlerrm); end;

  n := public.record_ticket_print(a1);
  n := public.record_ticket_print(a1);
  -- expect: 2
  insert into r(check_name,outcome) values ('C9 prints are counted', n::text);
  begin perform public.record_ticket_print(a2);
    insert into r(check_name,outcome) values ('C10 chef cannot print another kitchen''s ticket', 'ALLOWED');
  -- expect: forbidden: This ticket belongs to a kitchen you are not assigned to.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('C10 chef cannot print another kitchen''s ticket', h || ': ' || sqlerrm); end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007f2","role":"authenticated"}', true);
do $$
declare t public.kitchen_tickets;
begin
  t := public.set_line_ready((select v::uuid from ctx where k = 'A2bread'), 3);
  -- expect: ready
  insert into r(check_name,outcome) values ('C11 chef two finishes kitchen two in one tap', t.status::text);
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007c1","role":"authenticated"}', true);
do $$
declare h text; a1 uuid := (select v::uuid from ctx where k = 'A1');
begin
  begin perform public.start_ticket(a1);
    insert into r(check_name,outcome) values ('C12 counter staff cannot act on tickets', 'ALLOWED');
  -- expect: forbidden: Only the kitchen can update tickets.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('C12 counter staff cannot act on tickets', h || ': ' || sqlerrm); end;
  begin perform public.report_issue(a1, 'other', 'Counter note');
    insert into r(check_name,outcome) values ('C13 counter staff cannot report issues', 'ALLOWED');
  -- expect: forbidden: Only the kitchen can update tickets.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('C13 counter staff cannot report issues', h || ': ' || sqlerrm); end;
  -- expect: false / 1
  insert into r(check_name,outcome) values ('C14 progress while kitchen one is short',
    (select all_ready || ' / ' || open_issues from public.order_kitchen_progress where order_id = (select v::uuid from ctx where k = 'A')));
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007f1","role":"authenticated"}', true);
do $$
begin
  perform public.set_line_ready((select v::uuid from ctx where k = 'A1cake'), 2);
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}', true);
do $$
declare h text; a uuid := (select v::uuid from ctx where k = 'A'); a2 uuid := (select v::uuid from ctx where k = 'A2');
begin
  -- expect: true / preparing v3 / 1
  insert into r(check_name,outcome) values ('C15 all kitchens ready; order stays preparing',
    (select all_ready::text from public.order_kitchen_progress where order_id = a)
    || ' / ' || (select status || ' v' || version from public.orders where id = a)
    || ' / ' || (select count(*) from public.order_events where order_id = a and event_type = 'ready_count_corrected'));
  begin perform public.acknowledge_ticket(a2, 'ok');
    insert into r(check_name,outcome) values ('C16 admin exception needs a reason', 'ALLOWED');
  -- expect: forbidden: Give a reason of at least 5 characters for acting on a kitchen ticket.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('C16 admin exception needs a reason', h || ': ' || sqlerrm); end;
  perform public.resolve_issue((select id from public.kitchen_issues where ticket_id = (select v::uuid from ctx where k = 'A1')), ' Bought more cream ');
  -- expect: 0 / Bought more cream
  insert into r(check_name,outcome) values ('C17 admin resolves the issue',
    (select open_issues::text from public.order_kitchen_progress where order_id = a)
    || ' / ' || (select resolution from public.kitchen_issues where ticket_id = (select v::uuid from ctx where k = 'A1')));
  -- expect: kitchen_issue_reported, kitchen_issue_resolved, ready_count_corrected, ticket_acknowledged, ticket_ready, ticket_started
  insert into r(check_name,outcome) values ('C18 kitchen events in the order timeline',
    (select string_agg(distinct event_type, ', ' order by event_type) from public.order_events
     where order_id = a and event_type not in ('created', 'confirmed')));
  -- expect: B-990201-TK1 / T Kitchen One
  insert into r(check_name,outcome) values ('C19 events name the ticket and kitchen',
    (select data ->> 'ticket' || ' / ' || (data ->> 'kitchen') from public.order_events
     where order_id = a and event_type = 'ticket_acknowledged'));
end $$;

-- ===== Order changes and cancellation (Task 4) =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}', true);
do $$
declare
  o public.orders;
  e uuid := (select v::uuid from ctx where k = 'E');
  cake_line uuid := (select id from public.order_items where order_id = (select v::uuid from ctx where k = 'E') and product_name = 'T Kt Cake');
begin
  o := public.confirm_order(e, 1);                                               -- version 2
  -- expect: new, new
  insert into r(check_name,outcome) values ('D1 edit order starts with two new tickets',
    (select string_agg(status::text, ', ' order by reference) from public.kitchen_tickets where order_id = e));

  o := public.update_order_items(e, 2, jsonb_build_array(jsonb_build_object('line_id', cake_line, 'quantity', 2)),
         'Two cakes, no bread');                                                 -- version 3
  -- expect: TK1 new r2 revised | TK2 cancelled r1 Removed from the order / 1 / 1
  insert into r(check_name,outcome) values ('D2 edit rebuilds kitchen one and stops kitchen two',
    (select string_agg(right(reference, 3) || ' ' || status || ' r' || revision
                       || coalesce(' ' || cancel_reason, case when revised_at is not null then ' revised' else '' end),
                       ' | ' order by reference)
     from public.kitchen_tickets where order_id = e)
    || ' / ' || (select stop_work_pending from public.order_kitchen_progress where order_id = e)
    || ' / ' || (select count(*) from public.order_events where order_id = e and event_type = 'tickets_revised'));
  -- expect: 1 cancelled T Kt Bread
  insert into r(check_name,outcome) values ('D3 stop-work ticket keeps the removed line',
    (select count(*) || ' ' || min(l.status::text) || ' ' || min(l.product_name)
     from public.kitchen_ticket_lines l join public.kitchen_tickets t on t.id = l.ticket_id
     where t.order_id = e and t.reference like '%-TK2'));

  o := public.update_order_items(e, 3, jsonb_build_array(
         jsonb_build_object('line_id', cake_line, 'quantity', 2),
         jsonb_build_object('variant_id', (select v from ctx where k = 'bread'), 'quantity', 1)), 'Bread back on');  -- version 4
  -- expect: TK1 new r2 | TK2 new r2 / 1 line
  insert into r(check_name,outcome) values ('D4 re-adding a kitchen reopens its ticket; unchanged ticket untouched',
    (select string_agg(right(reference, 3) || ' ' || status || ' r' || revision, ' | ' order by reference)
     from public.kitchen_tickets where order_id = e)
    || ' / ' || (select count(*) from public.kitchen_ticket_lines l join public.kitchen_tickets t on t.id = l.ticket_id
                 where t.order_id = e and t.reference like '%-TK2') || ' line');

  o := public.reschedule_order(e, 4, pg_temp.day(4), 'Customer moved the pickup');  -- version 5
  -- expect: r3, r3 / true
  insert into r(check_name,outcome) values ('D5 reschedule revises every ticket',
    (select string_agg('r' || revision, ', ' order by reference) from public.kitchen_tickets where order_id = e)
    || ' / ' || (select bool_and(due_at = o.due_at)::text from public.kitchen_tickets where order_id = e));
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007f1","role":"authenticated"}', true);
do $$
begin
  perform public.acknowledge_ticket((select id from public.kitchen_tickets
    where order_id = (select v::uuid from ctx where k = 'E') and reference like '%-TK1'));
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}', true);
do $$
declare
  o public.orders; h text;
  e uuid := (select v::uuid from ctx where k = 'E');
  cake_line uuid := (select id from public.order_items where order_id = (select v::uuid from ctx where k = 'E') and product_name = 'T Kt Cake');
begin
  begin perform public.update_order_items(e, 5, jsonb_build_array(jsonb_build_object('line_id', cake_line, 'quantity', 3)), 'One more cake');
    insert into r(check_name,outcome) values ('D6 edit refused once the kitchen acknowledged', 'ALLOWED');
  -- expect: kitchen: The kitchen has already acknowledged this order. Cancel it and create a new one, or wait for kitchen revisions.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('D6 edit refused once the kitchen acknowledged', h || ': ' || sqlerrm); end;
  begin perform public.reschedule_order(e, 5, pg_temp.day(5), 'Later again');
    insert into r(check_name,outcome) values ('D7 reschedule refused once the kitchen acknowledged', 'ALLOWED');
  -- expect: kitchen: The kitchen has already acknowledged this order. Cancel it and create a new one, or wait for kitchen revisions.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('D7 reschedule refused once the kitchen acknowledged', h || ': ' || sqlerrm); end;

  o := public.cancel_order(e, 5, 'Customer cancelled');
  -- expect: cancelled, cancelled / 2 / cancelled, cancelled / Customer cancelled
  insert into r(check_name,outcome) values ('D8 cancelling raises stop-work on every ticket',
    (select string_agg(status::text, ', ' order by reference) from public.kitchen_tickets where order_id = e)
    || ' / ' || (select stop_work_pending from public.order_kitchen_progress where order_id = e)
    || ' / ' || (select string_agg(l.status::text, ', ' order by t.reference) from public.kitchen_ticket_lines l
                 join public.kitchen_tickets t on t.id = l.ticket_id where t.order_id = e)
    || ' / ' || (select min(cancel_reason) from public.kitchen_tickets where order_id = e));
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007f1","role":"authenticated"}', true);
do $$
declare
  h text; t public.kitchen_tickets;
  tk1 uuid := (select id from public.kitchen_tickets where order_id = (select v::uuid from ctx where k = 'E') and reference like '%-TK1');
begin
  begin perform public.start_ticket(tk1);
    insert into r(check_name,outcome) values ('D9 no work on a cancelled ticket', 'ALLOWED');
  -- expect: validation: This ticket was cancelled. Stop work on it.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('D9 no work on a cancelled ticket', h || ': ' || sqlerrm); end;
  t := public.acknowledge_stop_work(tk1);
  -- expect: true
  insert into r(check_name,outcome) values ('D10 chef acknowledges the stop-work', (t.stop_work_acknowledged_at is not null)::text);
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}', true);
do $$
begin
  -- expect: 1
  insert into r(check_name,outcome) values ('D11 one stop-work still pending',
    (select stop_work_pending::text from public.order_kitchen_progress where order_id = (select v::uuid from ctx where k = 'E')));
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007c1","role":"authenticated"}', true);
do $$
declare o public.orders; q uuid := (select v::uuid from ctx where k = 'Q');
begin
  o := public.update_order_items(q, 1, jsonb_build_array(
         jsonb_build_object('line_id', (select id from public.order_items where order_id = q), 'quantity', 2)));
  -- expect: pending_confirmation / 0
  insert into r(check_name,outcome) values ('D12 pending orders have no tickets and edit as before',
    o.status::text || ' / ' || (select count(*) from public.kitchen_tickets where order_id = q));
end $$;

reset role;
select check_name, outcome from r order by n;
rollback;
