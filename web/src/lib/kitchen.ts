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

// One entry of a ticket's unacknowledged change list (kitchen_tickets.pending_changes). An added
// item is a quantity change from 0, a removed one a quantity change to 0.
export type TicketChange = {
  key: string;
  kind: "quantity" | "notes" | "pickup";
  item: string;
  from: number | string | null;
  to: number | string | null;
};

const CHANGE_KINDS = new Set(["quantity", "notes", "pickup"]);
const isValue = (v: unknown) => v === null || typeof v === "number" || typeof v === "string";

export function parseTicketChanges(value: unknown): TicketChange[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is TicketChange =>
      typeof e === "object" && e !== null &&
      typeof e.key === "string" && typeof e.item === "string" && CHANGE_KINDS.has(e.kind) &&
      isValue(e.from) && isValue(e.to),
  );
}

// The words the chef reads, e.g. "Chocolate cake — 1 kg: 2 → 3".
export function describeChange(c: TicketChange, formatTime: (iso: string) => string): string {
  if (c.kind === "pickup") return `Pickup: ${formatTime(String(c.from))} → ${formatTime(String(c.to))}`;
  if (c.kind === "notes") return c.to ? `${c.item}: note “${c.to}”` : `${c.item}: note removed`;
  if (c.from === 0) return `New: ${c.item} × ${c.to}`;
  if (c.to === 0) return `${c.item}: removed`;
  return `${c.item}: ${c.from} → ${c.to}`;
}

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
  pending_changes: TicketChange[];
  changes_acknowledged_at: string | null;
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
// Within a group: tickets with unacknowledged changes first, then overdue, then earliest start-by,
// then earliest pickup. Empty groups are left out.
export function groupQueue<T extends { due_at: string; start_by: string; pending_changes?: unknown[] }>(
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
  const changedFirst = (t: T) => ((t.pending_changes?.length ?? 0) > 0 ? 0 : 1);
  for (const g of groups) {
    g.tickets.sort(
      (a, b) =>
        changedFirst(a) - changedFirst(b) ||
        overdueFirst(a) - overdueFirst(b) ||
        Date.parse(a.start_by) - Date.parse(b.start_by) ||
        Date.parse(a.due_at) - Date.parse(b.due_at),
    );
  }
  return groups.filter((g) => g.tickets.length > 0);
}

// Fired by a ticket card whose action failed on the network; the refresh indicator listens.
export const KITCHEN_OFFLINE_EVENT = "kitchen:offline";

export type ActionFollowUp = { refresh: boolean; offline: boolean; message: string | null };

// What a ticket card does after an action. Only refresh when the server answered: in Next 16 a
// refresh that fails on a dropped connection falls back to a full page load, which replaces the
// kitchen screen with the browser's offline page.
export function actionFollowUp(result: { ok?: boolean; message?: string } | "network-error"): ActionFollowUp {
  if (result === "network-error") return { refresh: false, offline: true, message: "Not saved, check the connection." };
  return { refresh: true, offline: false, message: result.ok ? null : (result.message ?? "Could not save.") };
}

// The chef's session is gone (signed out, expired, or the account was deactivated).
export class StampSignedOutError extends Error {
  constructor() {
    super("signed out");
    this.name = "StampSignedOutError";
  }
}

// Turns the answer of GET /kitchen/stamp into the stamp. A lost or deactivated session is a 401 from
// the route, or a redirect to /login from the proxy before the route runs (fetch follows it and gets
// the sign-in page). Both mean "sign in again", not "offline".
export async function readStampResponse(res: Pick<Response, "status" | "ok" | "redirected" | "url" | "json">): Promise<string> {
  if (res.status === 401 || (res.redirected && new URL(res.url).pathname === "/login")) throw new StampSignedOutError();
  if (!res.ok) throw new Error(`stamp ${res.status}`);
  const body = (await res.json()) as { stamp?: unknown };
  if (typeof body.stamp !== "string") throw new Error("stamp missing");
  return body.stamp;
}

export type PollResult = { kind: "ok"; stamp: string } | { kind: "offline" } | { kind: "signed_out" } | { kind: "busy" };

// Wraps the change-stamp request: at most one in flight (a slow network must not pile requests
// up), a hung request counts as offline after timeoutMs, and a lost session is reported as
// signed out so the screen can send the chef to /login instead of showing Offline forever.
export function createStampPoller(fetchStamp: (signal: AbortSignal) => Promise<string>, opts: { timeoutMs: number }) {
  let inFlight = false;
  return async function poll(): Promise<PollResult> {
    if (inFlight) return { kind: "busy" };
    inFlight = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<PollResult>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ kind: "offline" });
        }, opts.timeoutMs);
      });
      const request = fetchStamp(controller.signal).then(
        (stamp): PollResult => ({ kind: "ok", stamp }),
        (error: unknown): PollResult => (error instanceof StampSignedOutError ? { kind: "signed_out" } : { kind: "offline" }),
      );
      return await Promise.race([request, timeout]);
    } finally {
      clearTimeout(timer);
      inFlight = false;
    }
  };
}
