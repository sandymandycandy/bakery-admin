import { test } from "node:test";
import assert from "node:assert/strict";
import { kitchenWorkload, netCollected } from "./home.ts";

const now = Date.parse("2026-10-03T12:00:00Z");
const kitchens = [
  { id: "k1", name: "Kitchen 1" },
  { id: "k2", name: "Kitchen 2" },
];
const line = (quantity: number, ready_quantity: number, status = "pending") => ({ quantity, ready_quantity, status });
const ticket = (kitchen_id: string, status: string, start_by: string, due_at: string, lines: ReturnType<typeof line>[], has_pending_changes = false) =>
  ({ kitchen_id, status, start_by, due_at, has_pending_changes, kitchen_ticket_lines: lines });

test("workload per kitchen: open, not started, late starts, overdue, items left, changes", () => {
  const rows = kitchenWorkload(kitchens, [
    ticket("k1", "new", "2026-10-03T10:00:00Z", "2026-10-03T14:00:00Z", [line(2, 0)]),
    ticket("k1", "acknowledged", "2026-10-03T13:00:00Z", "2026-10-03T16:00:00Z", [line(1, 0)], true),
    ticket("k1", "preparing", "2026-10-03T08:00:00Z", "2026-10-03T11:00:00Z", [line(3, 1, "preparing"), line(4, 0, "cancelled")]),
    ticket("k2", "preparing", "2026-10-03T09:00:00Z", "2026-10-03T15:00:00Z", [line(5, 5, "ready"), line(2, 1, "preparing")]),
  ], now);
  assert.deepEqual(rows, [
    { kitchenId: "k1", name: "Kitchen 1", open: 3, notStarted: 2, lateStart: 1, overdue: 1, itemsLeft: 5, changes: 1 },
    { kitchenId: "k2", name: "Kitchen 2", open: 1, notStarted: 0, lateStart: 0, overdue: 0, itemsLeft: 1, changes: 0 },
  ]);
});

test("ready and cancelled tickets are not open work, but a Ready ticket's unacknowledged change still counts", () => {
  const rows = kitchenWorkload(kitchens, [
    ticket("k1", "ready", "2026-10-03T08:00:00Z", "2026-10-03T10:00:00Z", [line(1, 1, "ready")], true),
    ticket("k1", "cancelled", "2026-10-03T08:00:00Z", "2026-10-03T10:00:00Z", [line(1, 0, "cancelled")], true),
  ], now);
  assert.deepEqual(rows[0], { kitchenId: "k1", name: "Kitchen 1", open: 0, notStarted: 0, lateStart: 0, overdue: 0, itemsLeft: 0, changes: 1 });
  assert.equal(rows[1].open, 0);
});

test("tickets of a kitchen not in the list are ignored", () => {
  assert.equal(kitchenWorkload(kitchens, [ticket("k9", "new", "2026-10-03T10:00:00Z", "2026-10-03T14:00:00Z", [line(1, 0)])], now)
    .reduce((s, k) => s + k.open, 0), 0);
});

test("money collected: payments minus refunds", () => {
  assert.equal(netCollected([{ kind: "payment", amount_paise: 50000 }, { kind: "refund", amount_paise: 2000 }, { kind: "payment", amount_paise: 1000 }]), 49000);
  assert.equal(netCollected([]), 0);
});
