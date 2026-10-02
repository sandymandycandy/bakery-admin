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

import { actionFollowUp, createStampPoller } from "./kitchen.ts";

test("a server answer refreshes the page and keeps the screen online", () => {
  assert.deepEqual(actionFollowUp({ ok: true }), { refresh: true, offline: false, message: null });
  assert.deepEqual(actionFollowUp({ message: "This ticket was cancelled." }), {
    refresh: true,
    offline: false,
    message: "This ticket was cancelled.",
  });
});

test("a network failure does not refresh (that would reload into the browser's offline page) and marks the screen offline", () => {
  assert.deepEqual(actionFollowUp("network-error"), {
    refresh: false,
    offline: true,
    message: "Not saved, check the connection.",
  });
});

test("the stamp poller times out a hung request instead of waiting forever", async () => {
  const poll = createStampPoller(() => new Promise<string>(() => {}), { timeoutMs: 20 });
  assert.deepEqual(await poll(), { kind: "offline" });
});

test("the stamp poller skips a poll while the previous one is still running", async () => {
  let release: (s: string) => void = () => {};
  const poll = createStampPoller(() => new Promise<string>((r) => { release = r; }), { timeoutMs: 1000 });
  const first = poll();
  assert.deepEqual(await poll(), { kind: "busy" });
  release("3:2026-10-03T10:00:00Z");
  assert.deepEqual(await first, { kind: "ok", stamp: "3:2026-10-03T10:00:00Z" });
});
