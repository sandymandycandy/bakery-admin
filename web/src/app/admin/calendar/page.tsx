import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { OPEN_STATUSES, type OrderStatus } from "@/lib/orders";
import type { PickupAvailability } from "@/lib/capacity";
import { addDays, formatDayHeading, zonedDayKey, zonedDayRange } from "@/lib/time";
import { PageHeader, Select, cx } from "@/components/ui";
import type { OrdersByDay } from "./order-row";
import { AgendaView } from "./agenda-view";
import { DayView } from "./day-view";
import { MonthView } from "./month-view";
import { WeekView } from "./week-view";

export const metadata: Metadata = { title: "Calendar" };

function str(v: string | string[] | undefined) {
  return typeof v === "string" ? v : "";
}

const isDayKey = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

const VIEWS = ["agenda", "day", "week", "month"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL: Record<View, string> = { agenda: "Agenda", day: "Day", week: "Week", month: "Month" };
const AGENDA_DAYS = 14;

// Monday on or before a day ("YYYY-MM-DD").
const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
const shortDate = (day: string, withYear = false) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) }).format(
    new Date(`${day}T00:00:00Z`),
  );

export default async function CalendarPage({ searchParams }: PageProps<"/admin/calendar">) {
  await requireRole(["admin", "counter"]);
  const params = await searchParams;
  const tz = await getBusinessTimezone();
  const today = zonedDayKey(new Date(), tz);

  const view: View = (VIEWS as readonly string[]).includes(str(params.view)) ? (str(params.view) as View) : "agenda";
  const from = isDayKey(str(params.from)) ? str(params.from) : today;
  const source = ["IN_STORE", "CALL", "ONLINE"].includes(str(params.source)) ? (str(params.source) as "IN_STORE" | "CALL" | "ONLINE") : "";
  const kitchen = str(params.kitchen);
  const showClosed = str(params.closed) === "1";

  // Month view covers whole weeks (Mon–Sun) around the chosen month; week view is Mon–Sun.
  const monthStart = `${from.slice(0, 7)}-01`;
  const gridStart = mondayOf(monthStart);
  const weekStart = mondayOf(from);
  const [rangeStart, rangeDays]: [string, number] = {
    agenda: [from, AGENDA_DAYS] as [string, number],
    day: [from, 1] as [string, number],
    week: [weekStart, 7] as [string, number],
    month: [gridStart, 42] as [string, number],
  }[view];
  const { start, end } = zonedDayRange(rangeStart, tz, rangeDays);

  const supabase = await createClient();
  let query = supabase
    .from("order_summaries")
    .select("id, reference, source, status, customer_name, due_at, item_count, kitchen_ids")
    .gte("due_at", start.toISOString())
    .lt("due_at", end.toISOString())
    .order("due_at");
  if (!showClosed) query = query.in("status", [...OPEN_STATUSES, "completed"] as OrderStatus[]);
  if (source) query = query.eq("source", source);
  if (kitchen) query = query.contains("kitchen_ids", [kitchen]);

  const [{ data: orders }, { data: kitchens }, { data: closures }, availability] = await Promise.all([
    query,
    supabase.from("kitchens").select("id, name").order("sort_order"),
    supabase.from("closures").select("closed_on, reason").gte("closed_on", rangeStart).lt("closed_on", addDays(rangeStart, rangeDays)),
    view === "day"
      ? supabase.rpc("pickup_availability", { p_date: from }).then(({ data, error }) => (error ? null : (data as unknown as PickupAvailability)))
      : null,
  ]);
  const kitchenName = new Map((kitchens ?? []).map((k) => [k.id, k.name]));
  const closureByDay = new Map((closures ?? []).map((c) => [c.closed_on, c.reason]));

  const byDay: OrdersByDay = new Map();
  for (const o of orders ?? []) {
    if (!o.due_at) continue;
    const key = zonedDayKey(o.due_at, tz);
    byDay.set(key, [...(byDay.get(key) ?? []), o]);
  }

  const link = (overrides: Record<string, string>) => {
    const next = new URLSearchParams({ view, from, ...(source ? { source } : {}), ...(kitchen ? { kitchen } : {}), ...(showClosed ? { closed: "1" } : {}), ...overrides });
    return `/admin/calendar?${next.toString()}`;
  };
  const dayHref = (day: string) => link({ view: "day", from: day });

  const step = { agenda: AGENDA_DAYS, day: 1, week: 7, month: 0 }[view];
  const prevFrom = view === "month" ? addDays(monthStart, -1).slice(0, 7) + "-01" : addDays(from, -step);
  const nextFrom = view === "month" ? addDays(monthStart, 32).slice(0, 7) + "-01" : addDays(from, step);
  const rangeLabel = {
    agenda: `${formatDayHeading(from)} + ${AGENDA_DAYS} days`,
    day: formatDayHeading(from),
    week: `${shortDate(weekStart)} – ${shortDate(addDays(weekStart, 6), true)}`,
    month: new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${monthStart}T00:00:00Z`)),
  }[view];

  return (
    <>
      <PageHeader
        title="Calendar"
        description={`Orders by pickup time (${tz}), all sources. Pending requests are marked until confirmed.`}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-line bg-surface p-1">
          {VIEWS.map((v) => (
            <Link key={v} href={link({ view: v })} aria-current={view === v ? "page" : undefined}
              className={cx("rounded-md px-3 py-1.5 text-sm font-medium", view === v ? "bg-brand-soft text-brand-strong" : "text-muted hover:text-ink")}>
              {VIEW_LABEL[v]}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Link href={link({ from: prevFrom })} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-brand-soft" aria-label="Previous">←</Link>
          <Link href={link({ from: today })} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-brand-soft">Today</Link>
          <Link href={link({ from: nextFrom })} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-brand-soft" aria-label="Next">→</Link>
          <span className="ml-2 text-sm font-medium">{rangeLabel}</span>
        </div>
      </div>

      <form className="mb-5 flex flex-wrap items-end gap-3">
        <input type="hidden" name="view" value={view} />
        <input type="hidden" name="from" value={from} />
        <div>
          <label htmlFor="source" className="sr-only">Source</label>
          <Select id="source" name="source" defaultValue={source}>
            <option value="">All sources</option>
            <option value="IN_STORE">In-store</option>
            <option value="CALL">Call</option>
            <option value="ONLINE">Online</option>
          </Select>
        </div>
        <div>
          <label htmlFor="kitchen" className="sr-only">Kitchen</label>
          <Select id="kitchen" name="kitchen" defaultValue={kitchen}>
            <option value="">All kitchens</option>
            {(kitchens ?? []).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </Select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="closed" value="1" defaultChecked={showClosed} className="accent-brand" />
          Show cancelled and rejected
        </label>
        <button type="submit" className="rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium hover:bg-brand-soft">Apply</button>
      </form>

      {view === "month" && (
        <MonthView gridStart={gridStart} month={from.slice(0, 7)} today={today} byDay={byDay} closureByDay={closureByDay} dayHref={dayHref} />
      )}
      {view === "week" && (
        <WeekView weekStart={weekStart} today={today} byDay={byDay} closureByDay={closureByDay} tz={tz} dayHref={dayHref} />
      )}
      {view === "day" && (
        <DayView day={from} today={today} orders={byDay.get(from) ?? []} closure={closureByDay.get(from)} availability={availability}
          filtered={Boolean(source || kitchen || showClosed)} tz={tz} kitchenName={kitchenName} />
      )}
      {view === "agenda" && (
        <AgendaView from={from} days={AGENDA_DAYS} today={today} byDay={byDay} closureByDay={closureByDay} tz={tz} kitchenName={kitchenName} />
      )}
    </>
  );
}
