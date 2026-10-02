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
