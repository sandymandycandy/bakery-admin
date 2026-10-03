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

import { StampSignedOutError, actionFollowUp, createStampPoller, readStampResponse } from "./kitchen.ts";

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

const stampResponse = (over: Partial<Parameters<typeof readStampResponse>[0]> = {}) => ({
  status: 200,
  ok: true,
  redirected: false,
  url: "https://bakery.test/kitchen/stamp",
  json: async (): Promise<unknown> => ({ stamp: "3:2026-10-03T10:00:00Z" }),
  ...over,
});
const notSignedOut = (e: unknown) => !(e instanceof StampSignedOutError);

test("a good stamp response gives the stamp", async () => {
  assert.equal(await readStampResponse(stampResponse()), "3:2026-10-03T10:00:00Z");
});

test("a 401 (deactivated chef) means signed out, not offline", async () => {
  await assert.rejects(readStampResponse(stampResponse({ status: 401, ok: false })), StampSignedOutError);
});

test("a redirect to /login (the proxy found no session) means signed out, even though the page answers 200", async () => {
  const res = stampResponse({
    redirected: true,
    url: "https://bakery.test/login?next=%2Fkitchen%2Fstamp",
    json: async () => {
      throw new SyntaxError("Unexpected token '<'");
    },
  });
  await assert.rejects(readStampResponse(res), StampSignedOutError);
});

test("a server error or a malformed body is an ordinary failure, not a sign-out", async () => {
  await assert.rejects(readStampResponse(stampResponse({ status: 503, ok: false })), notSignedOut);
  await assert.rejects(readStampResponse(stampResponse({ json: async () => ({}) })), notSignedOut);
  // A redirect somewhere other than /login is not a sign-out either.
  await assert.rejects(
    readStampResponse(stampResponse({ redirected: true, url: "https://bakery.test/elsewhere", json: async () => ({}) })),
    notSignedOut,
  );
});

test("the stamp poller reports a lost session as signed out instead of offline", async () => {
  const poll = createStampPoller(async () => {
    throw new StampSignedOutError();
  }, { timeoutMs: 1000 });
  assert.deepEqual(await poll(), { kind: "signed_out" });
});

test("any other failure from the stamp request is offline", async () => {
  const poll = createStampPoller(async () => {
    throw new Error("network down");
  }, { timeoutMs: 1000 });
  assert.deepEqual(await poll(), { kind: "offline" });
});

import { describeChange, parseTicketChanges } from "./kitchen.ts";

const fmt = (iso: string) => `T(${iso.slice(11, 16)})`;

test("describes added, changed and removed items, notes and pickup moves", () => {
  const c = (kind: "quantity" | "notes" | "pickup", item: string, from: number | string | null, to: number | string | null) =>
    describeChange({ key: "k", kind, item, from, to }, fmt);
  assert.equal(c("quantity", "Chocolate cake — 1 kg", 2, 3), "Chocolate cake — 1 kg: 2 → 3");
  assert.equal(c("quantity", "Butter cookies — Each", 0, 12), "New: Butter cookies — Each × 12");
  assert.equal(c("quantity", "Plum cake — 500 g", 4, 0), "Plum cake — 500 g: removed");
  assert.equal(c("notes", "Chocolate cake — 1 kg", null, "Happy Birthday Asha"), "Chocolate cake — 1 kg: note “Happy Birthday Asha”");
  assert.equal(c("notes", "Chocolate cake — 1 kg", "Old", null), "Chocolate cake — 1 kg: note removed");
  assert.equal(c("pickup", "Pickup", "2026-10-04T11:30:00Z", "2026-10-04T13:30:00Z"), "Pickup: T(11:30) → T(13:30)");
});

test("parses change lists from the database and drops malformed entries", () => {
  const parsed = parseTicketChanges([
    { key: "qty:1", kind: "quantity", item: "Cake — 1 kg", from: 2, to: 3 },
    { key: "x", kind: "colour", item: "?", from: 1, to: 2 },
    "junk",
  ]);
  assert.deepEqual(parsed, [{ key: "qty:1", kind: "quantity", item: "Cake — 1 kg", from: 2, to: 3 }]);
  assert.deepEqual(parseTicketChanges(null), []);
});

test("tickets with unacknowledged changes come first in their day group", () => {
  const groups = groupQueue(
    [
      { id: "early", due_at: "2026-10-01T10:00:00Z", start_by: "2026-10-01T08:00:00Z", pending_changes: [] },
      { id: "changed", due_at: "2026-10-01T18:00:00Z", start_by: "2026-10-01T16:00:00Z", pending_changes: [{}] },
    ],
    opts,
  );
  assert.deepEqual(groups[0].tickets.map((t) => t.id), ["changed", "early"]);
});
