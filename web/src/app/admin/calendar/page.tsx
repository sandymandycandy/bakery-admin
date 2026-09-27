import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { OPEN_STATUSES, type OrderStatus } from "@/lib/orders";
import { addDays, formatDayHeading, formatTime, zonedDayKey, zonedDayRange } from "@/lib/time";
import { EmptyState, PageHeader, Select, cx } from "@/components/ui";
import { SourceBadge, StatusBadge } from "@/components/order-badges";

export const metadata: Metadata = { title: "Calendar" };

function str(v: string | string[] | undefined) {
  return typeof v === "string" ? v : "";
}

const isDayKey = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function CalendarPage({ searchParams }: PageProps<"/admin/calendar">) {
  await requireRole(["admin", "counter"]);
  const params = await searchParams;
  const tz = await getBusinessTimezone();
  const today = zonedDayKey(new Date(), tz);

  const view = str(params.view) === "month" ? "month" : "agenda";
  const from = isDayKey(str(params.from)) ? str(params.from) : today;
  const source = ["IN_STORE", "CALL", "ONLINE"].includes(str(params.source)) ? (str(params.source) as "IN_STORE" | "CALL" | "ONLINE") : "";
  const kitchen = str(params.kitchen);
  const showClosed = str(params.closed) === "1";

  // Month view covers whole weeks (Mon–Sun) around the chosen month.
  const monthStart = `${from.slice(0, 7)}-01`;
  const monthStartDow = (new Date(`${monthStart}T00:00:00Z`).getUTCDay() + 6) % 7;
  const gridStart = addDays(monthStart, -monthStartDow);
  const rangeStart = view === "month" ? gridStart : from;
  const rangeDays = view === "month" ? 42 : 14;
  const { start, end } = zonedDayRange(rangeStart, tz, rangeDays);

  const supabase = await createClient();
  let query = supabase
    .from("order_summaries")
    .select("id, reference, source, status, customer_name, due_at, item_count, kitchen_ids, confirmed_due_at")
    .gte("due_at", start.toISOString())
    .lt("due_at", end.toISOString())
    .order("due_at");
  if (!showClosed) query = query.in("status", [...OPEN_STATUSES, "completed"] as OrderStatus[]);
  if (source) query = query.eq("source", source);
  if (kitchen) query = query.contains("kitchen_ids", [kitchen]);

  const [{ data: orders }, { data: kitchens }, { data: closures }] = await Promise.all([
    query,
    supabase.from("kitchens").select("id, name").order("sort_order"),
    supabase.from("closures").select("closed_on, reason").gte("closed_on", rangeStart).lt("closed_on", addDays(rangeStart, rangeDays)),
  ]);
  const kitchenName = new Map((kitchens ?? []).map((k) => [k.id, k.name]));
  const closureByDay = new Map((closures ?? []).map((c) => [c.closed_on, c.reason]));

  const byDay = new Map<string, NonNullable<typeof orders>>();
  for (const o of orders ?? []) {
    if (!o.due_at) continue;
    const key = zonedDayKey(o.due_at, tz);
    byDay.set(key, [...(byDay.get(key) ?? []), o]);
  }

  const link = (overrides: Record<string, string>) => {
    const next = new URLSearchParams({ view, from, ...(source ? { source } : {}), ...(kitchen ? { kitchen } : {}), ...(showClosed ? { closed: "1" } : {}), ...overrides });
    return `/admin/calendar?${next.toString()}`;
  };
  const prevFrom = view === "month" ? addDays(monthStart, -1).slice(0, 7) + "-01" : addDays(from, -14);
  const nextFrom = view === "month" ? addDays(monthStart, 32).slice(0, 7) + "-01" : addDays(from, 14);
  const monthLabel = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${monthStart}T00:00:00Z`));

  return (
    <>
      <PageHeader
        title="Calendar"
        description={`Orders by pickup time (${tz}), all sources. Pending requests are marked until confirmed.`}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-line bg-surface p-1">
          {(["agenda", "month"] as const).map((v) => (
            <Link key={v} href={link({ view: v })} aria-current={view === v ? "page" : undefined}
              className={cx("rounded-md px-3 py-1.5 text-sm font-medium", view === v ? "bg-brand-soft text-brand-strong" : "text-muted hover:text-ink")}>
              {v === "agenda" ? "Agenda" : "Month"}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Link href={link({ from: prevFrom })} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-brand-soft" aria-label="Previous">←</Link>
          <Link href={link({ from: today })} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-brand-soft">Today</Link>
          <Link href={link({ from: nextFrom })} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-brand-soft" aria-label="Next">→</Link>
          <span className="ml-2 text-sm font-medium">{view === "month" ? monthLabel : `${formatDayHeading(from)} + 14 days`}</span>
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

      {view === "month" ? (
        <div className="overflow-x-auto">
          <div className="grid min-w-[700px] grid-cols-7 gap-px overflow-hidden rounded-xl border border-line bg-line text-sm">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="bg-canvas px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-muted">{d}</div>
            ))}
            {Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)).map((day) => {
              const dayOrders = byDay.get(day) ?? [];
              const pending = dayOrders.filter((o) => o.status === "pending_confirmation").length;
              const inMonth = day.startsWith(from.slice(0, 7));
              return (
                <Link key={day} href={link({ view: "agenda", from: day })}
                  className={cx("flex min-h-24 flex-col gap-1 bg-surface p-2 hover:bg-brand-soft/50", !inMonth && "bg-canvas/60 text-muted", day === today && "ring-2 ring-inset ring-brand")}>
                  <span className="text-xs font-medium">{Number(day.slice(8))}</span>
                  {closureByDay.has(day) && <span className="text-xs text-danger">Closed</span>}
                  {dayOrders.length > 0 && <span className="font-semibold">{dayOrders.length} order{dayOrders.length === 1 ? "" : "s"}</span>}
                  {pending > 0 && <span className="text-xs text-warn">{pending} pending</span>}
                </Link>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {Array.from({ length: 14 }, (_, i) => addDays(from, i)).map((day) => {
            const dayOrders = byDay.get(day) ?? [];
            const closure = closureByDay.get(day);
            if (dayOrders.length === 0 && !closure && day !== today) return null;
            return (
              <section key={day} aria-labelledby={`day-${day}`}>
                <h2 id={`day-${day}`} className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
                  {formatDayHeading(day)}
                  {day === today && <span className="text-xs font-medium text-brand">Today</span>}
                  {closure && <span className="text-xs font-medium text-danger">Closed: {closure}</span>}
                  <span className="text-xs font-normal text-muted">{dayOrders.length} order{dayOrders.length === 1 ? "" : "s"}</span>
                </h2>
                {dayOrders.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-line bg-surface px-4 py-3 text-sm text-muted">Nothing due.</p>
                ) : (
                  <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
                    {dayOrders.map((o) => (
                      <li key={o.id}>
                        <Link href={`/admin/orders/${o.id}`} className={cx("flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-canvas/60", o.status === "pending_confirmation" && "bg-warn-soft/40")}>
                          <span className="w-20 font-semibold tabular-nums">{o.due_at && formatTime(o.due_at, tz)}</span>
                          <span className="font-mono text-sm">{o.reference}</span>
                          <span className="min-w-32 flex-1">{o.customer_name ?? "Walk-in"}</span>
                          <span className="text-sm text-muted">{o.item_count} item{o.item_count === 1 ? "" : "s"}</span>
                          <span className="text-sm text-muted">{(o.kitchen_ids ?? []).map((k) => kitchenName.get(k)).filter(Boolean).join(" + ") || "No kitchen work"}</span>
                          {o.source && <SourceBadge source={o.source} />}
                          {o.status && <StatusBadge status={o.status} />}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
          {(orders ?? []).length === 0 && <EmptyState title="No orders in the next 14 days">Orders appear here by pickup time as soon as they are created.</EmptyState>}
        </div>
      )}
    </>
  );
}
