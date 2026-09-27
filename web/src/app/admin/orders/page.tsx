import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { formatPaise } from "@/lib/money";
import { OPEN_STATUSES, statusLabel, type OrderStatus } from "@/lib/orders";
import { formatDateTime, zonedDayKey, zonedDayRange } from "@/lib/time";
import { Alert, ButtonLink, EmptyState, Input, PageHeader, Select, cx } from "@/components/ui";
import { SourceBadge, StatusBadge } from "@/components/order-badges";

export const metadata: Metadata = { title: "Orders" };

type ListKey = "in_store" | "online_call";
type When = "today" | "upcoming" | "overdue" | "past" | "all";

const LISTS: Record<ListKey, { label: string; sources: ("IN_STORE" | "ONLINE" | "CALL")[] }> = {
  in_store: { label: "In-store", sources: ["IN_STORE"] },
  online_call: { label: "Online / Call", sources: ["ONLINE", "CALL"] },
};

function str(v: string | string[] | undefined) {
  return typeof v === "string" ? v : "";
}

export default async function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  await requireRole(["admin", "counter"]);
  const params = await searchParams;
  const list: ListKey = str(params.list) === "online_call" ? "online_call" : "in_store";
  const when: When = (["today", "upcoming", "overdue", "past", "all"] as const).find((w) => w === str(params.when)) ?? "today";
  const statusParam = str(params.status);
  const status: "open" | "all" | OrderStatus =
    statusParam === "all" ? "all" : (Object.keys(statusLabel) as OrderStatus[]).find((s) => s === statusParam) ?? "open";
  const q = str(params.q).trim().replace(/[^\p{L}\p{N}\s+-]/gu, "").slice(0, 60);

  const tz = await getBusinessTimezone();
  const today = zonedDayKey(new Date(), tz);
  const { start: todayStart, end: todayEnd } = zonedDayRange(today, tz);
  const now = new Date().toISOString();

  const supabase = await createClient();
  let query = supabase
    .from("order_summaries")
    .select("id, reference, source, status, customer_name, customer_phone, due_at, is_immediate, total_paise, balance_paise, item_count, kitchen_ids")
    .in("source", LISTS[list].sources)
    .limit(200);

  if (status === "open") query = query.in("status", OPEN_STATUSES);
  else if (status !== "all") query = query.eq("status", status);

  if (when === "today") query = query.gte("due_at", todayStart.toISOString()).lt("due_at", todayEnd.toISOString());
  if (when === "upcoming") query = query.gte("due_at", todayEnd.toISOString());
  if (when === "overdue") query = query.lt("due_at", now).in("status", OPEN_STATUSES);
  if (when === "past") query = query.lt("due_at", todayStart.toISOString());

  if (q) {
    const compact = q.replace(/\s/g, "");
    const ref = /^b-?(\d+)$/i.exec(compact);
    const digits = /^\+?(\d{3,})$/.exec(compact)?.[1];
    if (ref) query = query.eq("order_number", Number(ref[1]));
    // Bare digits could be an order number or part of a phone number; match either.
    else if (digits) query = query.or(`order_number.eq.${Number(digits)},customer_phone.ilike.*${digits}*`);
    else query = query.ilike("customer_name", `%${q}%`);
  }

  query = when === "past" ? query.order("due_at", { ascending: false }) : query.order("due_at", { ascending: true });

  const [{ data: orders, error }, { data: kitchens }, counts] = await Promise.all([
    query,
    supabase.from("kitchens").select("id, name"),
    Promise.all(
      (Object.keys(LISTS) as ListKey[]).map(async (key) => {
        const { count } = await supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .in("source", LISTS[key].sources)
          .in("status", OPEN_STATUSES)
          .gte("due_at", todayStart.toISOString())
          .lt("due_at", todayEnd.toISOString());
        return [key, count ?? 0] as const;
      }),
    ),
  ]);
  const kitchenName = new Map((kitchens ?? []).map((k) => [k.id, k.name]));
  const dueToday = Object.fromEntries(counts) as Record<ListKey, number>;

  const link = (overrides: Record<string, string>) => {
    const next = new URLSearchParams({ list, when, status, ...(q ? { q } : {}), ...overrides });
    return `/admin/orders?${next.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Orders"
        description={`Due times shown in ${tz}. Both lists share the same orders and lifecycle.`}
        actions={
          <>
            <ButtonLink href="/admin/orders/new?source=CALL" variant="secondary">New call order</ButtonLink>
            <ButtonLink href="/admin/orders/new?source=IN_STORE">New in-store order</ButtonLink>
          </>
        }
      />

      <nav aria-label="Order lists" className="mb-4 flex gap-1 border-b border-line">
        {(Object.keys(LISTS) as ListKey[]).map((key) => (
          <Link
            key={key}
            href={link({ list: key })}
            aria-current={list === key ? "page" : undefined}
            className={cx(
              "-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium",
              list === key ? "border-brand text-brand-strong" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {LISTS[key].label}
            <span className="rounded-full bg-canvas px-2 py-0.5 text-xs text-muted" title="Open orders due today">
              {dueToday[key]} today
            </span>
          </Link>
        ))}
      </nav>

      <form className="mb-4 flex flex-wrap items-end gap-3" role="search">
        <input type="hidden" name="list" value={list} />
        <div className="min-w-56 flex-1">
          <label htmlFor="q" className="sr-only">Search orders</label>
          <Input id="q" name="q" type="search" defaultValue={q} placeholder="Reference (B-1042), name, or phone" />
        </div>
        <div>
          <label htmlFor="when" className="sr-only">Due</label>
          <Select id="when" name="when" defaultValue={when}>
            <option value="today">Due today</option>
            <option value="upcoming">Upcoming</option>
            <option value="overdue">Overdue</option>
            <option value="past">Past</option>
            <option value="all">Any date</option>
          </Select>
        </div>
        <div>
          <label htmlFor="status" className="sr-only">Status</label>
          <Select id="status" name="status" defaultValue={status}>
            <option value="open">Open orders</option>
            <option value="all">All statuses</option>
            {(Object.keys(statusLabel) as OrderStatus[]).map((s) => (
              <option key={s} value={s}>{statusLabel[s]}</option>
            ))}
          </Select>
        </div>
        <button type="submit" className="rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium hover:bg-brand-soft">
          Filter
        </button>
      </form>

      {error ? (
        <Alert tone="danger" title="Could not load orders">{error.message}</Alert>
      ) : !orders || orders.length === 0 ? (
        <EmptyState title="No orders match">
          {when === "today" ? "Nothing due today in this list. Try Upcoming or Any date." : "Try a different filter."}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wider text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Order</th>
                <th scope="col" className="px-4 py-3 font-medium">Customer</th>
                <th scope="col" className="px-4 py-3 font-medium">Due</th>
                <th scope="col" className="px-4 py-3 font-medium">Items</th>
                <th scope="col" className="px-4 py-3 font-medium">Kitchens</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Total</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Balance</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {orders.map((o) => {
                const overdue = o.due_at && o.due_at < now && o.status && OPEN_STATUSES.includes(o.status);
                return (
                  <tr key={o.id} className="hover:bg-canvas/60">
                    <td className="px-4 py-3">
                      <Link href={`/admin/orders/${o.id}`} className="font-mono font-medium text-ink hover:text-brand hover:underline">
                        {o.reference}
                      </Link>
                      <div className="mt-1">{o.source && <SourceBadge source={o.source} />}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{o.customer_name ?? <span className="text-muted">Walk-in</span>}</div>
                      {o.customer_phone && <div className="text-xs text-muted">{o.customer_phone}</div>}
                    </td>
                    <td className={cx("px-4 py-3 whitespace-nowrap", overdue && "font-medium text-danger")}>
                      {o.due_at ? formatDateTime(o.due_at, tz) : "—"}
                      {o.is_immediate && <div className="text-xs text-muted">Walk-in</div>}
                      {overdue && <div className="text-xs">Overdue</div>}
                    </td>
                    <td className="px-4 py-3">{o.item_count}</td>
                    <td className="px-4 py-3 text-muted">
                      {(o.kitchen_ids ?? []).map((id) => kitchenName.get(id)).filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{formatPaise(o.total_paise ?? 0)}</td>
                    <td className={cx("px-4 py-3 text-right whitespace-nowrap", (o.balance_paise ?? 0) > 0 && "font-medium text-warn", (o.balance_paise ?? 0) < 0 && "font-medium text-danger")}>
                      {(o.balance_paise ?? 0) === 0 ? <span className="text-ok">Paid</span> : (o.balance_paise ?? 0) < 0 ? `Refund ${formatPaise(-(o.balance_paise ?? 0))}` : formatPaise(o.balance_paise ?? 0)}
                    </td>
                    <td className="px-4 py-3">{o.status && <StatusBadge status={o.status} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {orders.length === 200 && <p className="border-t border-line px-4 py-2 text-xs text-muted">Showing the first 200. Narrow the filters to see more.</p>}
        </div>
      )}
    </>
  );
}
