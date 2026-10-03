import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { formatPaise } from "@/lib/money";
import { OPEN_STATUSES } from "@/lib/orders";
import { addDays, formatDateTime, zonedDayKey, zonedDayRange } from "@/lib/time";
import { Alert, Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { SourceBadge, StatusBadge } from "@/components/order-badges";

export const metadata: Metadata = { title: "Home" };

function Stat({ label, value, href, tone }: { label: string; value: number | string; href: string; tone?: "warn" | "danger" }) {
  return (
    <Link href={href} className="rounded-xl border border-line bg-surface p-4 shadow-sm hover:border-brand/40">
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 text-3xl font-semibold ${tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : ""}`}>{value}</p>
    </Link>
  );
}

export default async function AdminHome() {
  const staff = await requireRole(["admin", "counter"]);
  const isAdmin = staff.role === "admin";
  const tz = await getBusinessTimezone();
  const today = zonedDayKey(new Date(), tz);
  const { start, end } = zonedDayRange(today, tz);
  const weekEnd = zonedDayRange(addDays(today, 1), tz, 7).end;
  const nowIso = new Date().toISOString();
  const supabase = await createClient();

  const [dueToday, pending, overdue, upcoming, unmapped, settings, chefs, products, readyOrders] = await Promise.all([
    supabase.from("order_summaries").select("id, source, status, balance_paise").in("status", OPEN_STATUSES)
      .gte("due_at", start.toISOString()).lt("due_at", end.toISOString()),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "pending_confirmation"),
    supabase.from("orders").select("id", { count: "exact", head: true }).in("status", OPEN_STATUSES).lt("due_at", nowIso),
    supabase.from("order_summaries").select("id, reference, source, status, customer_name, due_at").in("status", OPEN_STATUSES)
      .gte("due_at", end.toISOString()).lt("due_at", weekEnd.toISOString()).order("due_at").limit(10),
    supabase.from("unmapped_variants").select("product_id"),
    supabase.from("business_settings").select("gstin, fssai_licence").single(),
    isAdmin ? supabase.from("staff_profiles").select("user_id").eq("role", "chef").eq("is_active", true) : Promise.resolve({ data: null }),
    supabase.from("products").select("id", { count: "exact", head: true }).is("archived_at", null),
    supabase.from("order_summaries").select("id, reference, source, customer_name, due_at, balance_paise")
      .eq("status", "ready").order("due_at").limit(20),
  ]);

  const todays = dueToday.data ?? [];
  const inStore = todays.filter((o) => o.source === "IN_STORE").length;
  const balanceDue = todays.reduce((s, o) => s + Math.max(0, o.balance_paise ?? 0), 0);
  const unmappedCount = unmapped.data?.length ?? 0;
  // Packed and waiting for the customer; past the pickup time they are late collections (PRD 5D).
  const ready = readyOrders.data ?? [];
  const isLate = (due: string | null) => Boolean(due && Date.parse(due) < Date.parse(nowIso));
  const late = ready.filter((o) => isLate(o.due_at)).length;

  const setup = [
    { done: (products.count ?? 0) > 0, label: "Add categories and products", href: "/admin/products" },
    { done: (products.count ?? 0) > 0 && unmappedCount === 0, label: "Assign a kitchen to every made-to-order variant", href: "/admin/products" },
    { done: (chefs.data?.length ?? 0) > 0, label: "Create chef logins and assign kitchens", href: "/admin/staff" },
    { done: Boolean(settings.data?.gstin && settings.data?.fssai_licence), label: "Enter GSTIN and FSSAI licence number", href: "/admin/settings" },
  ];
  const setupOpen = isAdmin && setup.some((s) => !s.done);

  return (
    <>
      <PageHeader
        title={`Hello, ${staff.fullName.split(" ")[0]}`}
        description={`Today is ${formatDateTime(new Date(), tz).split(",")[0]}. “Due today” counts pickups, not orders created today.`}
        actions={
          <>
            <ButtonLink href="/admin/orders/new?source=CALL" variant="secondary">New call order</ButtonLink>
            <ButtonLink href="/admin/orders/new?source=IN_STORE">New in-store order</ButtonLink>
          </>
        }
      />

      <div className="flex flex-col gap-6">
        {unmappedCount > 0 && (
          <Alert tone="danger" title="Missing kitchen routing">
            {unmappedCount} made-to-order variant{unmappedCount === 1 ? "" : "s"} cannot be confirmed in orders yet.{" "}
            <Link href="/admin/products" className="font-medium underline">Review products</Link>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Due today (open)" value={todays.length} href="/admin/orders?when=today" />
          <Stat label="Awaiting confirmation" value={pending.count ?? 0} href="/admin/orders?list=online_call&when=all&status=pending_confirmation" tone={(pending.count ?? 0) > 0 ? "warn" : undefined} />
          <Stat label="Overdue" value={overdue.count ?? 0} href="/admin/orders?when=overdue" tone={(overdue.count ?? 0) > 0 ? "danger" : undefined} />
          <Stat label="Balance due today" value={formatPaise(balanceDue)} href="/admin/orders?when=today" />
        </div>
        <p className="-mt-3 text-sm text-muted">
          Due today: {inStore} in-store · {todays.length - inStore} online / call.
        </p>

        {ready.length > 0 && (
          <Card>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">
                Ready for pickup <span className="text-muted">({ready.length})</span>
              </h2>
              {late > 0 && <Badge tone="danger">{late} late</Badge>}
            </div>
            <ul className="divide-y divide-line">
              {ready.map((o) => {
                const overdue = isLate(o.due_at);
                return (
                  <li key={o.id}>
                    <Link href={`/admin/orders/${o.id}`} className="flex flex-wrap items-center gap-3 py-2.5 hover:text-brand">
                      <span className={`w-40 text-sm ${overdue ? "font-semibold text-danger" : ""}`}>{o.due_at && formatDateTime(o.due_at, tz)}</span>
                      <span className="font-mono text-sm">{o.reference}</span>
                      <span className="flex-1 text-sm">{o.customer_name ?? "Walk-in"}</span>
                      {o.source && <SourceBadge source={o.source} />}
                      {(o.balance_paise ?? 0) > 0 && <Badge tone="warn">Due {formatPaise(o.balance_paise ?? 0)}</Badge>}
                      {overdue && <Badge tone="danger">Late</Badge>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        <Card>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Next 7 days</h2>
            <Link href="/admin/calendar" className="text-sm text-brand hover:underline">Open calendar</Link>
          </div>
          {(upcoming.data ?? []).length === 0 ? (
            <p className="text-sm text-muted">No upcoming pickups.</p>
          ) : (
            <ul className="divide-y divide-line">
              {(upcoming.data ?? []).map((o) => (
                <li key={o.id}>
                  <Link href={`/admin/orders/${o.id}`} className="flex flex-wrap items-center gap-3 py-2.5 hover:text-brand">
                    <span className="w-40 text-sm">{o.due_at && formatDateTime(o.due_at, tz)}</span>
                    <span className="font-mono text-sm">{o.reference}</span>
                    <span className="flex-1 text-sm">{o.customer_name ?? "Walk-in"}</span>
                    {o.source && <SourceBadge source={o.source} />}
                    {o.status && <StatusBadge status={o.status} />}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {setupOpen && (
          <Card>
            <h2 className="text-lg font-semibold">Setup checklist</h2>
            <ul className="mt-4 flex flex-col gap-3">
              {setup.map((item) => (
                <li key={item.label} className="flex items-center justify-between gap-3">
                  <Link href={item.href} className="text-sm hover:text-brand hover:underline">{item.label}</Link>
                  {item.done ? <Badge tone="ok">Done</Badge> : <Badge tone="warn">To do</Badge>}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
