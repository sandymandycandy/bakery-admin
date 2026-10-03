import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { issueKindLabel, type IssueKind } from "@/lib/kitchen";
import { ticketsQuery, toKitchenTickets } from "@/lib/kitchen-data";
import { formatDateTime, zonedDayKey, zonedDayRange } from "@/lib/time";
import { Button, Card, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { StopWorkNotice, TicketCard } from "@/components/kitchen/ticket-card";
import { ResolveIssueForm } from "./resolve-issue";

export const metadata: Metadata = { title: "KOT" };

function str(v: string | string[] | undefined) {
  return typeof v === "string" ? v : "";
}

const STATUSES = ["open", "ready", "cancelled", "all"] as const;
const STATUS_LABEL: Record<(typeof STATUSES)[number], string> = { open: "Open", ready: "Ready", cancelled: "Cancelled", all: "All" };

export default async function KotPage({ searchParams }: PageProps<"/admin/kot">) {
  const staff = await requireRole(["admin", "counter"]);
  const isAdmin = staff.role === "admin";
  const mode = isAdmin ? "admin" : "view";
  const params = await searchParams;
  const tz = await getBusinessTimezone();
  const now = new Date();
  const nowIso = now.toISOString();
  const today = zonedDayKey(now, tz);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(str(params.day)) ? str(params.day) : today;
  const kitchen = str(params.kitchen);
  const source = str(params.source) === "in_store" || str(params.source) === "online_call" ? str(params.source) : "";
  const status = STATUSES.find((s) => s === str(params.status)) ?? "open";
  const { start, end } = zonedDayRange(day, tz);
  // "Open" on today also lists open tickets from earlier days: they are overdue and still need
  // attention, like the chef screen's Today group. Any other day or status shows just that day.
  const includeEarlier = status === "open" && day === today;

  const supabase = await createClient();
  let query = ticketsQuery(supabase).lt("due_at", end.toISOString()).order("due_at");
  if (!includeEarlier) query = query.gte("due_at", start.toISOString());
  if (kitchen) query = query.eq("kitchen_id", kitchen);
  if (source === "in_store") query = query.eq("source", "IN_STORE");
  if (source === "online_call") query = query.in("source", ["ONLINE", "CALL"]);
  if (status === "open") query = query.in("status", ["new", "acknowledged", "preparing"]);
  else if (status !== "all") query = query.eq("status", status);

  const [{ data: rows, error }, { data: kitchens }, { data: issues }, { data: stopRows }, { data: changedRows }] = await Promise.all([
    query,
    supabase.from("kitchens").select("id, name").order("sort_order"),
    supabase
      .from("kitchen_issues")
      .select("id, kind, note, reported_at, kitchen_tickets(reference, order_id)")
      .is("resolved_at", null)
      .order("reported_at"),
    ticketsQuery(supabase).eq("status", "cancelled").is("stop_work_acknowledged_at", null).order("cancelled_at"),
    ticketsQuery(supabase).eq("has_pending_changes", true).neq("status", "cancelled").order("revised_at"),
  ]);
  const stops = toKitchenTickets(stopRows);
  const changed = toKitchenTickets(changedRows);
  // Tickets awaiting acknowledgement of changes have their own list above; do not show them twice.
  const changedIds = new Set(changed.map((t) => t.id));
  const tickets = toKitchenTickets(rows).filter((t) => !changedIds.has(t.id));
  const kitchenName = new Map((kitchens ?? []).map((k) => [k.id, k.name]));

  return (
    <>
      <PageHeader title="KOT" description={`Kitchen tickets by pickup time (${tz}). Chefs work these on the kitchen screen.`} />

      <div className="flex flex-col gap-6">
        <Card>
          <h2 className="mb-3 text-lg font-semibold">Open issues</h2>
          {!issues || issues.length === 0 ? (
            <p className="text-sm text-muted">No open issues.</p>
          ) : (
            <ul className="divide-y divide-line">
              {issues.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium">
                      {issueKindLabel[i.kind as IssueKind] ?? i.kind}: {i.note}
                    </p>
                    <p className="text-sm text-muted">
                      {i.kitchen_tickets && (
                        <Link href={`/admin/orders/${i.kitchen_tickets.order_id}`} className="font-mono text-brand hover:underline">
                          {i.kitchen_tickets.reference}
                        </Link>
                      )}{" "}
                      · {formatDateTime(i.reported_at, tz)}
                    </p>
                  </div>
                  {isAdmin && <ResolveIssueForm issueId={i.id} />}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {stops.length > 0 && (
          <section aria-label="Stop-work not yet acknowledged" className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Stop-work not yet acknowledged</h2>
            {stops.map((t) => (
              <StopWorkNotice key={t.id} ticket={t} tz={tz} mode={mode} />
            ))}
          </section>
        )}

        {changed.length > 0 && (
          <section aria-label="Changes not yet acknowledged" className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Awaiting acknowledgement of changes</h2>
            <div className="grid gap-4 xl:grid-cols-2">
              {changed.map((t) => (
                <TicketCard key={t.id} ticket={t} tz={tz} mode={mode} nowIso={nowIso} orderHref={`/admin/orders/${t.order_id}`} />
              ))}
            </div>
          </section>
        )}

        <form className="flex flex-wrap items-end gap-3" role="search">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="kot-day" className="text-sm font-medium">Pickup day</label>
            <Input id="kot-day" type="date" name="day" defaultValue={day} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="kot-kitchen" className="text-sm font-medium">Kitchen</label>
            <Select id="kot-kitchen" name="kitchen" defaultValue={kitchen}>
              <option value="">All kitchens</option>
              {(kitchens ?? []).map((k) => (
                <option key={k.id} value={k.id}>{k.name}</option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="kot-source" className="text-sm font-medium">Source</label>
            <Select id="kot-source" name="source" defaultValue={source}>
              <option value="">All</option>
              <option value="in_store">In-store</option>
              <option value="online_call">Online &amp; Call</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="kot-status" className="text-sm font-medium">Status</label>
            <Select id="kot-status" name="status" defaultValue={status}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary">Show</Button>
        </form>
        {includeEarlier && (
          <p className="-mt-3 text-sm text-muted">Open tickets still not ready from earlier days are included, earliest first.</p>
        )}

        {error ? (
          <p role="alert" className="text-sm text-danger">Could not load tickets: {error.message}</p>
        ) : tickets.length === 0 ? (
          <EmptyState title="No tickets match">Tickets appear when orders with made-to-order items are confirmed.</EmptyState>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {tickets.map((t) => (
              <div key={t.id} className="flex flex-col gap-1">
                <p className="text-sm text-muted">{kitchenName.get(t.kitchen_id)}</p>
                <TicketCard ticket={t} tz={tz} mode={mode} nowIso={nowIso} orderHref={`/admin/orders/${t.order_id}`} />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
