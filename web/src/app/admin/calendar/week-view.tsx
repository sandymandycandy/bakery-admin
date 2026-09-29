import Link from "next/link";
import { addDays, formatTime } from "@/lib/time";
import { cx } from "@/components/ui";
import { plural, type OrdersByDay } from "./order-row";
import { WEEKDAYS } from "./month-view";

// Mon–Sun columns; each order is a compact chip. Column headers open the day view.
export function WeekView({ weekStart, today, byDay, closureByDay, tz, dayHref }: {
  weekStart: string;
  today: string;
  byDay: OrdersByDay;
  closureByDay: Map<string, string>;
  tz: string;
  dayHref: (day: string) => string;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[700px] grid-cols-7 gap-px overflow-hidden rounded-xl border border-line bg-line text-sm">
        {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((day, i) => {
          const dayOrders = byDay.get(day) ?? [];
          const closure = closureByDay.get(day);
          return (
            <section key={day} aria-labelledby={`week-${day}`} className={cx("flex min-h-64 flex-col bg-surface", day === today && "ring-2 ring-inset ring-brand")}>
              <Link id={`week-${day}`} href={dayHref(day)} className="flex flex-col border-b border-line bg-canvas px-2 py-1.5 hover:bg-brand-soft/50">
                <span className="text-xs font-medium uppercase tracking-wider text-muted">
                  {WEEKDAYS[i]} {Number(day.slice(8))}
                  {day === today && <span className="ml-1 normal-case tracking-normal text-brand">Today</span>}
                </span>
                <span className="text-xs text-muted">{plural(dayOrders.length, "order")}</span>
                {closure && <span className="text-xs text-danger" title={closure}>Closed</span>}
              </Link>
              <ul className="flex flex-col gap-1 p-1.5">
                {dayOrders.map((o) => {
                  const pending = o.status === "pending_confirmation";
                  const dropped = o.status === "cancelled" || o.status === "rejected";
                  return (
                    <li key={o.id}>
                      <Link href={`/admin/orders/${o.id}`}
                        className={cx("block rounded-md border px-1.5 py-1 text-xs leading-tight hover:border-brand",
                          pending ? "border-warn/40 bg-warn-soft/60" : "border-line bg-canvas/40",
                          dropped && "text-muted line-through")}>
                        <span className="font-semibold tabular-nums">{o.due_at && formatTime(o.due_at, tz)}</span>{" "}
                        <span className="font-mono">{o.reference}</span>
                        <span className="block truncate">{o.customer_name ?? "Walk-in"}</span>
                        {pending && <span className="font-medium text-warn">Pending</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
