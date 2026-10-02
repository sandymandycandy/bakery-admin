// Kitchen ticket types, labels and queue ordering. Pure: imported by unit tests, so keep any
// imports from "@/" type-only.
import type { Enums } from "@/lib/database.types";
import type { OrderSource } from "@/lib/orders";

export type TicketStatus = Enums<"ticket_status">;
export type TicketLineStatus = Enums<"ticket_line_status">;
export type IssueKind = "ingredient" | "equipment" | "quality" | "other";

export type KitchenTicketLine = {
  id: string;
  line_no: number;
  product_name: string;
  variant_name: string;
  quantity: number;
  ready_quantity: number;
  is_veg: boolean;
  contains_egg: boolean;
  is_eggless: boolean;
  allergens: string[];
  notes: string | null;
  lead_time_minutes: number;
  status: TicketLineStatus;
};

export type KitchenIssue = {
  id: string;
  line_id: string | null;
  kind: string;
  note: string;
  reported_at: string;
  resolved_at: string | null;
  resolution: string | null;
};

export type KitchenTicket = {
  id: string;
  order_id: string;
  kitchen_id: string;
  reference: string;
  revision: number;
  source: OrderSource;
  status: TicketStatus;
  due_at: string;
  start_by: string;
  revised_at: string | null;
  ready_at: string | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
  stop_work_acknowledged_at: string | null;
  print_count: number;
  lines: KitchenTicketLine[];
  issues: KitchenIssue[];
};

export const ticketStatusLabel: Record<TicketStatus, string> = {
  new: "New",
  acknowledged: "Acknowledged",
  preparing: "Preparing",
  ready: "Ready",
  cancelled: "Cancelled",
};

export const ticketStatusTone: Record<TicketStatus, "neutral" | "brand" | "ok" | "warn" | "danger"> = {
  new: "warn",
  acknowledged: "brand",
  preparing: "brand",
  ready: "ok",
  cancelled: "danger",
};

export const issueKindLabel: Record<IssueKind, string> = {
  ingredient: "Ingredient out",
  equipment: "Equipment",
  quality: "Quality",
  other: "Other",
};

// Matches private.ticket_actor: admins acting as the kitchen give a reason of at least this length.
export const ADMIN_KITCHEN_REASON_MIN = 5;

export type QueueGroup<T> = { key: "today" | "tomorrow" | "later"; label: string; tickets: T[] };

// The chef's active queue: Today (including overdue work from earlier days), Tomorrow, Later.
// Within a group: overdue first, then earliest start-by, then earliest pickup. Empty groups are left out.
export function groupQueue<T extends { due_at: string; start_by: string }>(
  tickets: T[],
  opts: { now: Date; todayKey: string; tomorrowKey: string; dayKeyOf: (iso: string) => string },
): QueueGroup<T>[] {
  const groups: QueueGroup<T>[] = [
    { key: "today", label: "Today", tickets: [] },
    { key: "tomorrow", label: "Tomorrow", tickets: [] },
    { key: "later", label: "Later", tickets: [] },
  ];
  for (const t of tickets) {
    const day = opts.dayKeyOf(t.due_at);
    const group = day <= opts.todayKey ? groups[0] : day === opts.tomorrowKey ? groups[1] : groups[2];
    group.tickets.push(t);
  }
  const now = opts.now.getTime();
  const overdueFirst = (t: T) => (Date.parse(t.due_at) < now ? 0 : 1);
  for (const g of groups) {
    g.tickets.sort(
      (a, b) =>
        overdueFirst(a) - overdueFirst(b) ||
        Date.parse(a.start_by) - Date.parse(b.start_by) ||
        Date.parse(a.due_at) - Date.parse(b.due_at),
    );
  }
  return groups.filter((g) => g.tickets.length > 0);
}
