import Link from "next/link";
import { addDays } from "@/lib/time";
import { cx } from "@/components/ui";
import { plural, type OrdersByDay } from "./order-row";

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MonthView({ gridStart, month, today, byDay, closureByDay, dayHref }: {
  gridStart: string;
  month: string; // "YYYY-MM"
  today: string;
  byDay: OrdersByDay;
  closureByDay: Map<string, string>;
  dayHref: (day: string) => string;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[700px] grid-cols-7 gap-px overflow-hidden rounded-xl border border-line bg-line text-sm">
        {WEEKDAYS.map((d) => (
          <div key={d} className="bg-canvas px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-muted">{d}</div>
        ))}
        {Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)).map((day) => {
          const dayOrders = byDay.get(day) ?? [];
          const pending = dayOrders.filter((o) => o.status === "pending_confirmation").length;
          const inMonth = day.startsWith(month);
          return (
            <Link key={day} href={dayHref(day)}
              className={cx("flex min-h-24 flex-col gap-1 bg-surface p-2 hover:bg-brand-soft/50", !inMonth && "bg-canvas/60 text-muted", day === today && "ring-2 ring-inset ring-brand")}>
              <span className="text-xs font-medium">{Number(day.slice(8))}</span>
              {closureByDay.has(day) && <span className="text-xs text-danger">Closed</span>}
              {dayOrders.length > 0 && <span className="font-semibold">{plural(dayOrders.length, "order")}</span>}
              {pending > 0 && <span className="text-xs text-warn">{pending} pending</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
