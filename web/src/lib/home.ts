// Home screen figures. Pure: imported by unit tests, so keep any imports from "@/" type-only.

export type WorkloadTicket = {
  kitchen_id: string;
  status: string;
  start_by: string;
  due_at: string;
  has_pending_changes: boolean;
  kitchen_ticket_lines: { quantity: number; ready_quantity: number; status: string }[];
};

export type KitchenWorkload = {
  kitchenId: string;
  name: string;
  open: number; // tickets still being worked on (new, acknowledged, preparing)
  notStarted: number; // new or acknowledged
  lateStart: number; // not started and past their start-by time
  overdue: number; // open and past their pickup time
  itemsLeft: number; // pieces still to make on open tickets (removed lines excluded)
  changes: number; // live tickets (also Ready ones) with a change the kitchen has not acknowledged
};

const OPEN = new Set(["new", "acknowledged", "preparing"]);
const NOT_STARTED = new Set(["new", "acknowledged"]);

export function kitchenWorkload(kitchens: { id: string; name: string }[], tickets: WorkloadTicket[], nowMs: number): KitchenWorkload[] {
  return kitchens.map((k) => {
    const mine = tickets.filter((t) => t.kitchen_id === k.id);
    const open = mine.filter((t) => OPEN.has(t.status));
    return {
      kitchenId: k.id,
      name: k.name,
      open: open.length,
      notStarted: open.filter((t) => NOT_STARTED.has(t.status)).length,
      lateStart: open.filter((t) => NOT_STARTED.has(t.status) && Date.parse(t.start_by) < nowMs).length,
      overdue: open.filter((t) => Date.parse(t.due_at) < nowMs).length,
      itemsLeft: open.reduce(
        (sum, t) => sum + t.kitchen_ticket_lines.filter((l) => l.status !== "cancelled").reduce((s, l) => s + Math.max(0, l.quantity - l.ready_quantity), 0),
        0,
      ),
      changes: mine.filter((t) => t.status !== "cancelled" && t.has_pending_changes).length,
    };
  });
}

// Money received minus money refunded (payment dates, the same rule as the sales report).
export function netCollected(payments: { kind: string; amount_paise: number }[]): number {
  return payments.reduce((sum, p) => sum + (p.kind === "refund" ? -p.amount_paise : p.amount_paise), 0);
}
