import { test } from "node:test";
import assert from "node:assert/strict";
import { groupQueue } from "./kitchen.ts";

// Day keys taken straight from the ISO date keep the test independent of timezones.
const opts = {
  now: new Date("2026-10-01T09:00:00Z"),
  todayKey: "2026-10-01",
  tomorrowKey: "2026-10-02",
  dayKeyOf: (iso: string) => iso.slice(0, 10),
};

const ticket = (id: string, due: string, startBy: string) => ({ id, due_at: due, start_by: startBy });

test("groups tickets into Today, Tomorrow and Later, leaving out empty groups", () => {
  const groups = groupQueue(
    [
      ticket("later", "2026-10-05T10:00:00Z", "2026-10-05T08:00:00Z"),
      ticket("today", "2026-10-01T12:00:00Z", "2026-10-01T10:00:00Z"),
    ],
    opts,
  );
  assert.deepEqual(groups.map((g) => [g.key, g.tickets.map((t) => t.id)]), [
    ["today", ["today"]],
    ["later", ["later"]],
  ]);
});

test("overdue work from an earlier day is in Today and comes first", () => {
  const groups = groupQueue(
    [
      ticket("soon", "2026-10-01T10:00:00Z", "2026-10-01T08:30:00Z"),
      ticket("yesterday", "2026-09-30T15:00:00Z", "2026-09-30T13:00:00Z"),
      ticket("tomorrow", "2026-10-02T09:00:00Z", "2026-10-02T07:00:00Z"),
    ],
    opts,
  );
  assert.deepEqual(groups[0].tickets.map((t) => t.id), ["yesterday", "soon"]);
  assert.equal(groups[1].key, "tomorrow");
});

test("within a group, earlier start-by first, then earlier pickup", () => {
  const groups = groupQueue(
    [
      ticket("b", "2026-10-01T16:00:00Z", "2026-10-01T12:00:00Z"),
      ticket("c", "2026-10-01T15:00:00Z", "2026-10-01T12:00:00Z"),
      ticket("a", "2026-10-01T18:00:00Z", "2026-10-01T10:00:00Z"),
    ],
    opts,
  );
  assert.deepEqual(groups[0].tickets.map((t) => t.id), ["a", "c", "b"]);
});
