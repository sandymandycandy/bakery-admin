import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { addDays, zonedDayKey, zonedDayRange } from "@/lib/time";
import { groupQueue } from "@/lib/kitchen";
import { ticketStamp, ticketsQuery, toKitchenTickets } from "@/lib/kitchen-data";
import { Alert, EmptyState, cx } from "@/components/ui";
import { RefreshStatus } from "@/components/kitchen/refresh-status";
import { StopWorkNotice, TicketCard } from "@/components/kitchen/ticket-card";

export const metadata: Metadata = { title: "Kitchen" };

function str(v: string | string[] | undefined) {
  return typeof v === "string" ? v : "";
}

function Chip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "rounded-full border px-4 py-2 text-base font-medium",
        active ? "border-brand bg-brand-soft text-brand-strong" : "border-line bg-surface hover:border-brand",
      )}
    >
      {children}
    </Link>
  );
}

export default async function KitchenPage({ searchParams }: PageProps<"/kitchen">) {
  const chef = await requireRole(["chef"]);
  const params = await searchParams;
  const tab = str(params.tab) === "done" ? "done" : "active";
  const kitchenId = chef.kitchens.some((k) => k.id === str(params.k)) ? str(params.k) : "all";
  const src = str(params.src) === "in_store" || str(params.src) === "online_call" ? str(params.src) : "all";
  const tz = await getBusinessTimezone();
  const now = new Date();
  const nowIso = now.toISOString();
  const todayKey = zonedDayKey(now, tz);
  const since = zonedDayRange(todayKey, tz).start.toISOString();

  const supabase = await createClient();
  // Ready tickets stay on Active while the kitchen has not acknowledged a change to them (5C).
  let active = ticketsQuery(supabase)
    .neq("status", "cancelled")
    .or("status.in.(new,acknowledged,preparing),has_pending_changes.is.true");
  let stops = ticketsQuery(supabase).eq("status", "cancelled").is("stop_work_acknowledged_at", null).order("cancelled_at");
  let done = ticketsQuery(supabase)
    // A Ready ticket with unacknowledged changes stays on Active only (5C).
    .or(`and(status.eq.ready,has_pending_changes.is.false,ready_at.gte."${since}"),and(status.eq.cancelled,stop_work_acknowledged_at.gte."${since}")`)
    .order("due_at");
  if (kitchenId !== "all") {
    active = active.eq("kitchen_id", kitchenId);
    stops = stops.eq("kitchen_id", kitchenId);
    done = done.eq("kitchen_id", kitchenId);
  }
  if (src === "in_store") active = active.eq("source", "IN_STORE");
  if (src === "online_call") active = active.in("source", ["ONLINE", "CALL"]);

  const [activeRes, stopsRes, doneRes, stamp] = await Promise.all([active, stops, done, ticketStamp(supabase)]);
  const stopTickets = toKitchenTickets(stopsRes.data);
  const doneTickets = toKitchenTickets(doneRes.data);
  const groups = groupQueue(toKitchenTickets(activeRes.data), {
    now,
    todayKey,
    tomorrowKey: addDays(todayKey, 1),
    dayKeyOf: (iso) => zonedDayKey(iso, tz),
  });
  const loadError = activeRes.error ?? stopsRes.error ?? doneRes.error;
  const link = (overrides: Record<string, string>) => `/kitchen?${new URLSearchParams({ tab, k: kitchenId, src, ...overrides })}`;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-surface px-5 py-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-brand">Auri Bakery · Kitchen</p>
          <h1 className="text-xl font-semibold">
            {chef.kitchens.length ? chef.kitchens.map((k) => k.name).join(" + ") : "No kitchen assigned"}
          </h1>
        </div>
        <RefreshStatus stamp={stamp} tz={tz} loadedAt={nowIso} />
        <div className="flex items-center gap-4">
          <span className="text-base">{chef.fullName}</span>
          <form action={signOut}>
            <button type="submit" className="rounded-lg border border-line px-4 py-2.5 text-base font-medium hover:bg-brand-soft">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-5 p-5">
        {chef.kitchens.length === 0 ? (
          <Alert tone="danger" title="You are not assigned to a kitchen">
            Ask an admin to assign you to a kitchen before tickets can appear here.
          </Alert>
        ) : (
          <>
            {loadError && <Alert tone="danger" title="Could not load tickets">{loadError.message}</Alert>}

            {stopTickets.length > 0 && (
              <section aria-label="Stop-work notices" className="flex flex-col gap-3">
                {stopTickets.map((t) => (
                  <StopWorkNotice key={t.id} ticket={t} tz={tz} mode="chef" />
                ))}
              </section>
            )}

            <nav aria-label="Ticket views" className="flex flex-wrap items-center gap-2">
              <Chip href={link({ tab: "active" })} active={tab === "active"}>Active</Chip>
              <Chip href={link({ tab: "done" })} active={tab === "done"}>Done today</Chip>
              <span className="mx-2 h-6 w-px bg-line" aria-hidden />
              <Chip href={link({ src: "all" })} active={src === "all"}>All</Chip>
              <Chip href={link({ src: "in_store" })} active={src === "in_store"}>In-store</Chip>
              <Chip href={link({ src: "online_call" })} active={src === "online_call"}>Online &amp; Call</Chip>
              {chef.kitchens.length > 1 && (
                <>
                  <span className="mx-2 h-6 w-px bg-line" aria-hidden />
                  <Chip href={link({ k: "all" })} active={kitchenId === "all"}>All kitchens</Chip>
                  {chef.kitchens.map((k) => (
                    <Chip key={k.id} href={link({ k: k.id })} active={kitchenId === k.id}>{k.name}</Chip>
                  ))}
                </>
              )}
            </nav>

            {tab === "active" ? (
              groups.length === 0 ? (
                <EmptyState title="No active tickets">New tickets appear here as soon as an order is confirmed.</EmptyState>
              ) : (
                groups.map((g) => (
                  <section key={g.key} className="flex flex-col gap-3">
                    <h2 className="text-xl font-semibold">
                      {g.label} <span className="text-muted">({g.tickets.length})</span>
                    </h2>
                    <div className="grid gap-4 xl:grid-cols-2">
                      {g.tickets.map((t) => (
                        <TicketCard key={t.id} ticket={t} tz={tz} mode="chef" nowIso={nowIso} />
                      ))}
                    </div>
                  </section>
                ))
              )
            ) : doneTickets.length === 0 ? (
              <EmptyState title="Nothing finished yet today" />
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {doneTickets.map((t) => (
                  <TicketCard key={t.id} ticket={t} tz={tz} mode="view" nowIso={nowIso} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
