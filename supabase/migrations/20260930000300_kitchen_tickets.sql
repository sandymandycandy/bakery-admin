-- Phase 5A: kitchen tickets (docs/superpowers/specs/2026-09-30-kitchen-tickets-design.md).
-- Confirmed orders get one ticket per kitchen. Chefs read only their kitchens' tickets and never
-- see prices, customers, or other order data. Tickets are written only through the functions below.

create type public.ticket_status as enum ('new', 'acknowledged', 'preparing', 'ready', 'cancelled');
create type public.ticket_line_status as enum ('pending', 'preparing', 'ready', 'cancelled');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.kitchen_tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  kitchen_id uuid not null references public.kitchens (id) on delete restrict,
  reference text not null unique,
  revision integer not null default 1 check (revision >= 1),
  source public.order_source not null,
  status public.ticket_status not null default 'new',
  due_at timestamptz not null,
  start_by timestamptz not null,
  revised_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users (id) on delete set null,
  started_at timestamptz,
  started_by uuid references auth.users (id) on delete set null,
  ready_at timestamptz,
  ready_by uuid references auth.users (id) on delete set null,
  cancelled_at timestamptz,
  cancel_reason text,
  stop_work_acknowledged_at timestamptz,
  stop_work_acknowledged_by uuid references auth.users (id) on delete set null,
  print_count integer not null default 0 check (print_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, kitchen_id)
);
create index kitchen_tickets_queue_idx on public.kitchen_tickets (kitchen_id, status, due_at);
create index kitchen_tickets_updated_at_idx on public.kitchen_tickets (updated_at desc);
create index kitchen_tickets_acknowledged_by_idx on public.kitchen_tickets (acknowledged_by);
create index kitchen_tickets_started_by_idx on public.kitchen_tickets (started_by);
create index kitchen_tickets_ready_by_idx on public.kitchen_tickets (ready_by);
create index kitchen_tickets_stop_work_by_idx on public.kitchen_tickets (stop_work_acknowledged_by);

-- Snapshot of the order's made-to-order lines for one kitchen. order_item_id becomes null when an
-- edit deletes the order line, so a stop-work ticket keeps showing what to stop.
create table public.kitchen_ticket_lines (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.kitchen_tickets (id) on delete cascade,
  order_item_id uuid unique references public.order_items (id) on delete set null,
  line_no integer not null,
  product_name text not null,
  variant_name text not null,
  quantity integer not null check (quantity >= 1),
  ready_quantity integer not null default 0,
  is_veg boolean not null,
  contains_egg boolean not null,
  is_eggless boolean not null,
  allergens text[] not null default '{}',
  notes text,
  lead_time_minutes integer not null,
  status public.ticket_line_status not null default 'pending',
  check (ready_quantity between 0 and quantity)
);
create index kitchen_ticket_lines_ticket_id_idx on public.kitchen_ticket_lines (ticket_id);

create table public.kitchen_issues (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.kitchen_tickets (id) on delete cascade,
  line_id uuid references public.kitchen_ticket_lines (id) on delete set null,
  kind text not null check (kind in ('ingredient', 'equipment', 'quality', 'other')),
  note text not null check (length(trim(note)) between 3 and 500),
  reported_by uuid references auth.users (id) on delete set null,
  reported_at timestamptz not null default now(),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  resolution text check (resolution is null or length(trim(resolution)) between 3 and 500),
  check ((resolved_at is null) = (resolution is null))
);
create index kitchen_issues_ticket_id_idx on public.kitchen_issues (ticket_id);
create index kitchen_issues_line_id_idx on public.kitchen_issues (line_id);
create index kitchen_issues_reported_by_idx on public.kitchen_issues (reported_by);
create index kitchen_issues_resolved_by_idx on public.kitchen_issues (resolved_by);

create trigger kitchen_tickets_updated_at before update on public.kitchen_tickets
  for each row execute function private.set_updated_at();
create trigger kitchen_tickets_audit after insert or update or delete on public.kitchen_tickets
  for each row execute function private.audit_row('id');
create trigger kitchen_ticket_lines_audit after insert or update or delete on public.kitchen_ticket_lines
  for each row execute function private.audit_row('id');
create trigger kitchen_issues_audit after insert or update or delete on public.kitchen_issues
  for each row execute function private.audit_row('id');

-- One row per order with tickets, for the order lists, calendar, and order page.
create view public.order_kitchen_progress
with (security_invoker = true)
as
select
  t.order_id,
  count(*) filter (where t.status <> 'cancelled') as ticket_count,
  count(*) filter (where t.status = 'ready') as ready_count,
  (count(*) filter (where t.status <> 'cancelled') > 0
   and count(*) filter (where t.status not in ('ready', 'cancelled')) = 0) as all_ready,
  (select count(*) from public.kitchen_issues i join public.kitchen_tickets t2 on t2.id = i.ticket_id
   where t2.order_id = t.order_id and i.resolved_at is null) as open_issues,
  count(*) filter (where t.status = 'cancelled' and t.stop_work_acknowledged_at is null) as stop_work_pending
from public.kitchen_tickets t
group by t.order_id;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

-- Admin and counter see every kitchen; a chef sees the kitchens assigned in staff_kitchens.
create function private.can_see_kitchen(p_kitchen_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_staff_role() in ('admin', 'counter'), false)
    or (private.current_staff_role() = 'chef'
        and exists (select 1 from public.staff_kitchens sk
                    where sk.user_id = (select auth.uid()) and sk.kitchen_id = p_kitchen_id))
$$;

alter table public.kitchen_tickets enable row level security;
alter table public.kitchen_ticket_lines enable row level security;
alter table public.kitchen_issues enable row level security;

create policy "Staff read tickets of their kitchens" on public.kitchen_tickets for select to authenticated
  using ((select private.can_see_kitchen(kitchen_id)));
create policy "Staff read ticket lines of their kitchens" on public.kitchen_ticket_lines for select to authenticated
  using (exists (select 1 from public.kitchen_tickets t where t.id = ticket_id));
create policy "Staff read issues of their kitchens" on public.kitchen_issues for select to authenticated
  using (exists (select 1 from public.kitchen_tickets t where t.id = ticket_id));

revoke all on public.kitchen_tickets, public.kitchen_ticket_lines, public.kitchen_issues, public.order_kitchen_progress
  from anon, authenticated;
grant select on public.kitchen_tickets, public.kitchen_ticket_lines, public.kitchen_issues, public.order_kitchen_progress
  to authenticated;

revoke execute on function private.can_see_kitchen(uuid) from public;
grant execute on function private.can_see_kitchen(uuid) to authenticated;
-- ---------------------------------------------------------------------------
-- Ticket building
-- ---------------------------------------------------------------------------

-- Replaces a ticket's lines with the order's current made-to-order lines for its kitchen.
create function private.fill_ticket_lines(p_ticket_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.kitchen_ticket_lines where ticket_id = p_ticket_id;
  insert into public.kitchen_ticket_lines (
    ticket_id, order_item_id, line_no, product_name, variant_name, quantity,
    is_veg, contains_egg, is_eggless, allergens, notes, lead_time_minutes)
  select t.id, oi.id, oi.line_no, oi.product_name, oi.variant_name, oi.quantity - oi.cancelled_quantity,
         oi.is_veg, oi.contains_egg, oi.is_eggless, oi.allergens, oi.notes, oi.lead_time_minutes
  from public.kitchen_tickets t
  join public.order_items oi on oi.order_id = t.order_id and oi.kitchen_id = t.kitchen_id
  where t.id = p_ticket_id and oi.prep_type = 'made_to_order' and oi.quantity > oi.cancelled_quantity;
$$;

-- What one kitchen should see of an order, in the same shape as its ticket lines, to detect changes.
create function private.ticket_signature(p_order_id uuid, p_kitchen_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_array(oi.id, oi.product_name, oi.variant_name,
                                              oi.quantity - oi.cancelled_quantity, oi.notes) order by oi.line_no), '[]')
  from public.order_items oi
  where oi.order_id = p_order_id and oi.kitchen_id = p_kitchen_id
    and oi.prep_type = 'made_to_order' and oi.quantity > oi.cancelled_quantity
$$;

-- Creates or refreshes the order's tickets: one per kitchen with active made-to-order lines.
-- Unchanged tickets are left alone; changed or reopened ones get revision + 1; kitchens that no
-- longer have lines are cancelled (a stop-work notice). Callers must have checked that no ticket is
-- past New (private.kitchen_guard) before an order edit. Returns the number of existing tickets
-- revised or cancelled (0 on a first build).
create function private.build_tickets(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  k record;
  t public.kitchen_tickets;
  current_lines jsonb;
  changed integer := 0;
  dropped integer;
begin
  select * into o from public.orders where id = p_order_id;
  if not found then
    perform private.fail('Order not found.', 'not_found');
  end if;

  for k in
    select oi.kitchen_id, kc.code, max(oi.lead_time_minutes) as lead
    from public.order_items oi
    join public.kitchens kc on kc.id = oi.kitchen_id
    where oi.order_id = o.id and oi.prep_type = 'made_to_order' and oi.quantity > oi.cancelled_quantity
    group by oi.kitchen_id, kc.code
  loop
    select * into t from public.kitchen_tickets where order_id = o.id and kitchen_id = k.kitchen_id for update;
    if not found then
      insert into public.kitchen_tickets (order_id, kitchen_id, reference, source, due_at, start_by)
      values (o.id, k.kitchen_id, o.reference || '-' || k.code, o.source, o.due_at,
              o.due_at - make_interval(mins => k.lead))
      returning * into t;
      perform private.fill_ticket_lines(t.id);
    else
      select coalesce(jsonb_agg(jsonb_build_array(l.order_item_id, l.product_name, l.variant_name, l.quantity, l.notes)
                                order by l.line_no), '[]')
      into current_lines
      from public.kitchen_ticket_lines l where l.ticket_id = t.id;
      if t.status = 'cancelled' or t.due_at is distinct from o.due_at
         or current_lines is distinct from private.ticket_signature(o.id, k.kitchen_id) then
        perform private.fill_ticket_lines(t.id);
        update public.kitchen_tickets
        set status = 'new', revision = revision + 1, revised_at = now(),
            due_at = o.due_at, start_by = o.due_at - make_interval(mins => k.lead),
            acknowledged_at = null, acknowledged_by = null, started_at = null, started_by = null,
            ready_at = null, ready_by = null, cancelled_at = null, cancel_reason = null,
            stop_work_acknowledged_at = null, stop_work_acknowledged_by = null
        where id = t.id;
        changed := changed + 1;
      end if;
    end if;
  end loop;

  -- Kitchens with no active lines left: stop their work. Their lines stay as a record.
  -- (Alias kt, not t: t is a variable here.)
  update public.kitchen_ticket_lines l
  set status = 'cancelled'
  from public.kitchen_tickets kt
  where l.ticket_id = kt.id and kt.order_id = o.id and kt.status <> 'cancelled'
    and not exists (select 1 from public.order_items oi
                    where oi.order_id = o.id and oi.kitchen_id = kt.kitchen_id
                      and oi.prep_type = 'made_to_order' and oi.quantity > oi.cancelled_quantity);
  update public.kitchen_tickets kt
  set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Removed from the order'
  where kt.order_id = o.id and kt.status <> 'cancelled'
    and not exists (select 1 from public.order_items oi
                    where oi.order_id = o.id and oi.kitchen_id = kt.kitchen_id
                      and oi.prep_type = 'made_to_order' and oi.quantity > oi.cancelled_quantity);
  get diagnostics dropped = row_count;
  return changed + dropped;
end;
$$;

revoke execute on function
  private.fill_ticket_lines(uuid),
  private.ticket_signature(uuid, uuid),
  private.build_tickets(uuid)
  from public;

-- Confirming now creates the kitchen tickets (5A).
create or replace function private.confirm_locked(o public.orders, p_override_reason text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  role public.staff_role := private.current_staff_role();
  unmapped text;
  problem text;
  cap_msg text; -- 4C
  cap_kind text; -- 4C
  result public.orders;
begin
  if role = 'counter' and o.source <> 'IN_STORE' then
    perform private.fail('Only an admin can confirm call and online orders.', 'forbidden');
  end if;
  if role is null or role not in ('admin', 'counter') then
    perform private.fail('You do not have permission to confirm orders.', 'forbidden');
  end if;
  if o.status not in ('draft', 'pending_confirmation') then
    perform private.fail(format('Only draft or pending orders can be confirmed; this one is %s.', replace(o.status::text, '_', ' ')));
  end if;

  -- Pick up kitchen mappings fixed since the order was taken, then block if any are still missing (AC-06).
  update public.order_items oi
  set kitchen_id = v.kitchen_id
  from public.product_variants v
  where oi.order_id = o.id and oi.variant_id = v.id
    and oi.prep_type = 'made_to_order' and oi.kitchen_id is null and v.kitchen_id is not null;

  select string_agg(product_name || ' — ' || variant_name, ', ') into unmapped
  from public.order_items
  where order_id = o.id and prep_type = 'made_to_order' and kitchen_id is null and quantity > cancelled_quantity;
  if unmapped is not null then
    perform private.fail(format('Assign a preparing kitchen before confirming: %s.', unmapped), 'unmapped');
  end if;

  problem := private.lead_time_problem(o.id, o.requested_due_at);
  if problem is not null and p_override_reason is null then
    perform private.fail(problem || ' An admin can override with a reason.', 'lead_time');
  end if;

  -- 4C: windows and category caps (walk-in immediate orders do not reserve capacity).
  if not o.is_immediate then
    select c.message, c.kind into cap_msg, cap_kind from private.capacity_problem(o.id, o.requested_due_at) c;
    if cap_msg is not null and p_override_reason is null then
      perform private.fail(cap_msg || ' An admin can override with a reason.', cap_kind);
    end if;
  end if;

  update public.orders
  set status = 'confirmed',
      confirmed_due_at = requested_due_at,
      confirmed_by = auth.uid(),
      confirmed_at = now(),
      version = version + 1
  where id = o.id
  returning * into result;

  perform private.build_tickets(result.id); -- 5A: tickets on confirmation

  perform private.log_order_event(o.id, 'confirmed', p_override_reason,
    jsonb_strip_nulls(jsonb_build_object('lead_time', problem, 'capacity', cap_msg))); -- 4C
  return result;
end;
$$;
