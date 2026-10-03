import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { formatPaise } from "@/lib/money";
import { paymentMethodLabel, sourceLabel } from "@/lib/orders";
import { dateToZonedLocal, formatDateTime } from "@/lib/time";
import { Alert, Badge, Card, PageHeader, VegMark, cx } from "@/components/ui";
import { KitchenFlags, SourceBadge, StatusBadge } from "@/components/order-badges";
import { NoShowPanel, OrderActions, PaymentForm } from "./order-actions";
import { FulfilmentPanel } from "./fulfilment-panel";
import { BillPanel, DiscountForm } from "./billing-panel";
import { EditItems } from "./edit-items";
import { loadCatalogue } from "@/lib/catalogue";
import { ticketsQuery, toKitchenTickets } from "@/lib/kitchen-data";
import { describeChange, parseTicketChanges, ticketStatusLabel } from "@/lib/kitchen";
import { StopWorkNotice, TicketCard } from "@/components/kitchen/ticket-card";

export const metadata: Metadata = { title: "Order" };

const eventLabel: Record<string, string> = {
  created: "Order created",
  confirmed: "Confirmed",
  rejected: "Rejected",
  cancelled: "Cancelled",
  rescheduled: "Pickup time changed",
  override: "Admin override",
  payment_recorded: "Payment recorded",
  refund_recorded: "Refund recorded",
  discount_applied: "Discount applied",
  discount_removed: "Discount removed",
  items_changed: "Items changed",
  bill_issued: "GST bill issued",
  credit_note_issued: "Credit note issued",
  completed: "Completed",
  ticket_acknowledged: "Kitchen acknowledged",
  ticket_started: "Kitchen started",
  ticket_ready: "Kitchen ticket ready",
  ready_count_corrected: "Ready count corrected",
  kitchen_issue_reported: "Kitchen issue reported",
  kitchen_issue_resolved: "Kitchen issue resolved",
  stop_work_acknowledged: "Stop-work acknowledged",
  tickets_revised: "Kitchen tickets revised",
  ticket_changes_acknowledged: "Kitchen acknowledged changes",
  no_show_recorded: "No-show recorded",
  no_show_undone: "No-show undone",
  packed: "Packed",
  packing_reopened: "Packing reopened",
  handed_over: "Handed over",
};

// PRD 5F: only orders the customer should have collected can count as a no-show.
const NO_SHOW_STATUSES = ["confirmed", "preparing", "ready", "cancelled"];

export default async function OrderPage({ params, searchParams }: PageProps<"/admin/orders/[id]">) {
  const staff = await requireRole(["admin", "counter"]);
  const isAdmin = staff.role === "admin";
  const { id } = await params;
  const { created } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const tz = await getBusinessTimezone();

  const supabase = await createClient();
  const [{ data: order }, { data: items }, { data: payments }, { data: events }, { data: kitchens }, { data: staffRows }, { data: bill }, { data: settings }, { data: noShow }] =
    await Promise.all([
      supabase.from("order_summaries").select("*").eq("id", id).maybeSingle(),
      supabase.from("order_items").select("*").eq("order_id", id).order("line_no"),
      supabase.from("payments").select("*").eq("order_id", id).order("recorded_at"),
      supabase.from("order_events").select("*").eq("order_id", id).order("occurred_at"),
      supabase.from("kitchens").select("id, name"),
      supabase.from("staff_profiles").select("user_id, full_name"),
      supabase.from("bills").select("id, bill_number, total_paise, issued_at, credit_notes(id, credit_note_number, total_paise, reason, issued_at)").eq("order_id", id).maybeSingle(),
      supabase.from("business_settings").select("counter_discount_limit_bps").single(),
      // order_summaries predates the no-show and packing columns, so read them (and the customer's flags) from orders.
      supabase
        .from("orders")
        .select("no_show_at, no_show_by, packed_at, packed_by, packing_note, handed_over_by, collected_by, credit_reason, customers(id, is_blocked, no_show_count)")
        .eq("id", id)
        .maybeSingle(),
    ]);
  if (!order || !order.id || !order.status || !order.source) notFound();

  const kitchenName = new Map((kitchens ?? []).map((k) => [k.id, k.name]));
  const staffName = new Map((staffRows ?? []).map((s) => [s.user_id, s.full_name]));
  const who = (userId: string | null) => (userId ? staffName.get(userId) ?? "Staff" : "System");
  const balance = order.balance_paise ?? 0;
  const refundable = (order.paid_paise ?? 0) - (order.refunded_paise ?? 0);
  const closed = ["completed", "rejected", "cancelled"].includes(order.status);
  const customer = noShow?.customers ?? null;
  const canRecordNoShow =
    Boolean(customer) && !noShow?.no_show_at && NO_SHOW_STATUSES.includes(order.status) &&
    order.due_at !== null && new Date(order.due_at) <= new Date();
  const unmapped = (items ?? []).filter((i) => i.prep_type === "made_to_order" && !i.kitchen_id);
  // Items can change until kitchen work starts; confirmed orders only by an admin (update_order_items).
  const tickets = toKitchenTickets((await ticketsQuery(supabase).eq("order_id", id).order("reference")).data);
  const kitchenAllReady = tickets.some((t) => t.status !== "cancelled") && tickets.every((t) => t.status === "ready" || t.status === "cancelled");
  const kitchenIssues = tickets.some((t) => t.issues.some((i) => !i.resolved_at));
  const waitingKitchens = tickets
    .filter((t) => t.status !== "ready" && t.status !== "cancelled")
    .map((t) => `${kitchenName.get(t.kitchen_id) ?? "Kitchen"} (${ticketStatusLabel[t.status].toLowerCase()})`);
  // Items can change on draft and pending orders, and (admin, with a reason) on confirmed and
  // preparing ones: kitchens get a revision to acknowledge (5C). Packed orders are reopened first.
  const canEditItems =
    !bill && (["draft", "pending_confirmation"].includes(order.status) || (["confirmed", "preparing"].includes(order.status) && isAdmin));
  const unacknowledged = tickets
    .filter((t) => t.status !== "cancelled" && t.pending_changes.length > 0)
    .map((t) => kitchenName.get(t.kitchen_id) ?? "Kitchen");
  const catalogue = canEditItems ? await loadCatalogue(supabase) : [];

  const itemList = (
    <ul className="divide-y divide-line">
      {(items ?? []).map((i) => {
        // 5C: an item removed after the kitchen acknowledged stays on the order, fully cancelled.
        const removed = i.quantity === i.cancelled_quantity;
        return (
          <li key={i.id} className={cx("flex flex-wrap items-start justify-between gap-3 py-3", removed && "opacity-60")}>
            <div className="min-w-0">
              <p className={cx("font-medium", removed && "line-through")}>
                {removed ? i.quantity : i.quantity - i.cancelled_quantity} × {i.product_name} — {i.variant_name}
              </p>
              {removed && <Badge tone="danger" className="mt-1">Removed</Badge>}
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                <VegMark isVeg={i.is_veg} />
                {i.is_eggless ? <Badge tone="ok">Eggless</Badge> : i.contains_egg && <Badge>Contains egg</Badge>}
                {i.prep_type === "ready_stock" ? (
                  <Badge>Ready stock</Badge>
                ) : (
                  <Badge tone={i.kitchen_id ? "brand" : "danger"}>{i.kitchen_id ? kitchenName.get(i.kitchen_id) : "No kitchen"}</Badge>
                )}
                {i.allergens.length > 0 && <span className="text-xs text-muted">Allergens: {i.allergens.join(", ")}</span>}
              </div>
              {i.notes && <p className="mt-1 text-sm">“{i.notes}”</p>}
            </div>
            <div className="text-right">
              <p className="font-medium">{formatPaise(i.line_total_paise)}</p>
              <p className="text-xs text-muted">{formatPaise(i.unit_price_paise)} each · GST {i.tax_rate_bps / 100}%</p>
            </div>
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      <PageHeader
        title={`Order ${order.reference}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/admin/orders?list=${order.source === "IN_STORE" ? "in_store" : "online_call"}`} className="text-brand hover:underline">
              {order.source === "IN_STORE" ? "In-store" : "Online / Call"}
            </Link>
            <span>/</span>
            <SourceBadge source={order.source} />
            <StatusBadge status={order.status} />
            <KitchenFlags progress={{ all_ready: kitchenAllReady, open_issues: kitchenIssues ? 1 : 0, changes_pending: unacknowledged.length }} />
          </span>
        }
      />

      <div className="flex flex-col gap-6">
        {created === "1" && (
          <Alert tone="ok" title={order.status === "confirmed" ? "Order created and confirmed" : "Order created"}>
            {order.status === "pending_confirmation"
              ? "It is waiting for confirmation before any kitchen work is released."
              : tickets.length > 0
                ? "Kitchen tickets have gone to the kitchens."
                : "No kitchen work is needed: pack the items when the customer is ready."}
          </Alert>
        )}
        {order.closed_reason && (
          <Alert tone="danger" title={order.status === "rejected" ? "Rejected" : "Cancelled"}>
            {order.closed_reason} — {who(order.closed_by)}, {order.closed_at && formatDateTime(order.closed_at, tz)}
          </Alert>
        )}
        {!closed && unmapped.length > 0 && (
          <Alert tone="danger" title="Kitchen assignment needed">
            {unmapped.map((i) => `${i.product_name} — ${i.variant_name}`).join(", ")}. Fix the product mapping, then confirm.
          </Alert>
        )}
        {balance < 0 && (
          <Alert tone="warn" title={`Refund due: ${formatPaise(-balance)}`}>
            The customer has paid more than this order now costs. Record the refund once it has actually been paid out.
          </Alert>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <h2 className="mb-3 text-lg font-semibold">Items</h2>
            {canEditItems ? (
              <EditItems
                key={`e-${order.version}`}
                orderId={order.id}
                version={order.version ?? 0}
                isAdmin={isAdmin}
                needsReason={["confirmed", "preparing"].includes(order.status)}
                discountPaise={order.discount_paise ?? 0}
                catalogue={catalogue}
                existing={(items ?? []).filter((i) => i.quantity > i.cancelled_quantity).map((i) => ({
                  id: i.id,
                  productName: i.product_name,
                  variantName: i.variant_name,
                  unitPricePaise: i.unit_price_paise,
                  quantity: i.quantity,
                  notes: i.notes ?? "",
                  isEggless: i.is_eggless,
                }))}
              >
                {itemList}
              </EditItems>
            ) : (
              itemList
            )}
            {order.status === "ready" && isAdmin && !bill && (
              <p className="mt-2 text-sm text-muted">To change items or the pickup time, reopen packing first.</p>
            )}
            <dl className="mt-3 flex flex-col gap-1 border-t border-line pt-3 text-sm">
              {(order.discount_paise ?? 0) > 0 && (
                <>
                  <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{formatPaise(order.subtotal_paise ?? 0)}</dd></div>
                  <div className="flex justify-between text-ok">
                    <dt>Discount{order.discount_reason && ` · ${order.discount_reason}`}{order.discount_by && ` (${who(order.discount_by)})`}</dt>
                    <dd>−{formatPaise(order.discount_paise ?? 0)}</dd>
                  </div>
                </>
              )}
              <div className="flex justify-between"><dt className="text-muted">Included GST</dt><dd>{formatPaise(order.tax_paise ?? 0)}</dd></div>
              <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd>{formatPaise(order.total_paise ?? 0)}</dd></div>
              {(order.credited_paise ?? 0) > 0 && (
                <div className="flex justify-between text-danger"><dt>Credited</dt><dd>−{formatPaise(order.credited_paise ?? 0)}</dd></div>
              )}
            </dl>
            {!closed && !bill && (
              <div className="mt-3">
                <DiscountForm
                  key={`d-${order.version}`}
                  orderId={order.id}
                  version={order.version ?? 0}
                  currentDiscountPaise={order.discount_paise ?? 0}
                  isAdmin={isAdmin}
                  limitBps={settings?.counter_discount_limit_bps ?? 1000}
                />
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-lg font-semibold">Pickup</h2>
            <dl className="flex flex-col gap-3 text-sm">
              <div>
                <dt className="text-muted">Due</dt>
                <dd className="font-medium">
                  {order.due_at ? formatDateTime(order.due_at, tz) : "—"}
                  {order.is_immediate && " (walk-in)"}
                </dd>
                {!order.confirmed_due_at && !closed && <dd className="text-xs text-warn">Requested, not yet confirmed</dd>}
              </div>
              <div>
                <dt className="text-muted">Customer</dt>
                <dd className="flex flex-wrap items-center gap-2 font-medium">
                  {customer && isAdmin ? (
                    <Link href={`/admin/customers/${customer.id}`} className="hover:text-brand hover:underline">{order.customer_name ?? "Customer"}</Link>
                  ) : (
                    order.customer_name ?? "Walk-in"
                  )}
                  {customer?.is_blocked && <Badge tone="danger">Blocked</Badge>}
                  {customer && customer.no_show_count > 0 && (
                    <Badge tone="warn">{customer.no_show_count} no-show{customer.no_show_count === 1 ? "" : "s"}</Badge>
                  )}
                </dd>
                {order.customer_phone && (
                  <dd><a href={`tel:${order.customer_phone}`} className="text-brand hover:underline">{order.customer_phone}</a></dd>
                )}
              </div>
              <div>
                <dt className="text-muted">Source</dt>
                <dd>{sourceLabel[order.source]} · taken by {who(order.created_by)}</dd>
              </div>
              {order.customer_notes && (
                <div><dt className="text-muted">Customer notes</dt><dd>{order.customer_notes}</dd></div>
              )}
              {order.internal_notes && (
                <div><dt className="text-muted">Internal notes</dt><dd>{order.internal_notes}</dd></div>
              )}
            </dl>
            <div className="mt-4">
              <NoShowPanel
                key={`n-${order.version}`}
                orderId={order.id}
                version={order.version ?? 0}
                isAdmin={isAdmin}
                canRecord={canRecordNoShow}
                recorded={noShow?.no_show_at ? { label: `${formatDateTime(noShow.no_show_at, tz)} · ${who(noShow.no_show_by)}` } : null}
              />
            </div>
            <div className="mt-5 border-t border-line pt-4">
              <OrderActions
                key={order.version}
                orderId={order.id}
                version={order.version ?? 0}
                status={order.status}
                isAdmin={isAdmin}
                canConfirm={isAdmin || order.source === "IN_STORE"}
                dueLocal={order.due_at ? dateToZonedLocal(new Date(order.due_at), tz) : ""}
                categoryIds={[...new Set((items ?? []).map((i) => i.category_id).filter((id): id is string => Boolean(id)))]}
              />
            </div>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {["confirmed", "preparing", "ready", "completed"].includes(order.status) && (
            <Card className="lg:col-span-2">
              <h2 className="mb-3 text-lg font-semibold">Packing &amp; handover</h2>
              <FulfilmentPanel
                key={`f-${order.version}`}
                orderId={order.id}
                version={order.version ?? 0}
                status={order.status}
                isAdmin={isAdmin}
                balancePaise={balance}
                waitingKitchens={waitingKitchens}
                openIssues={kitchenIssues}
                unacknowledged={unacknowledged}
                packed={noShow?.packed_at ? { label: `${formatDateTime(noShow.packed_at, tz)} · ${who(noShow.packed_by)}`, note: noShow.packing_note } : null}
                handedOver={
                  noShow?.handed_over_by && order.completed_at
                    ? { label: `${formatDateTime(order.completed_at, tz)} · ${who(noShow.handed_over_by)}`, collectedBy: noShow.collected_by, creditReason: noShow.credit_reason }
                    : null
                }
              />
            </Card>
          )}
          <Card>
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-semibold">Payments</h2>
              <p className="text-sm">
                Paid {formatPaise((order.paid_paise ?? 0) - (order.refunded_paise ?? 0))} ·{" "}
                <span className={balance > 0 ? "font-semibold text-warn" : balance < 0 ? "font-semibold text-danger" : "font-semibold text-ok"}>
                  {balance > 0 ? `Balance ${formatPaise(balance)}` : balance < 0 ? `Refund due ${formatPaise(-balance)}` : "Fully paid"}
                </span>
              </p>
            </div>
            {payments && payments.length > 0 ? (
              <ul className="mb-4 divide-y divide-line text-sm">
                {payments.map((p) => (
                  <li key={p.id} className="flex justify-between gap-3 py-2">
                    <div>
                      <span className={p.kind === "refund" ? "font-medium text-danger" : "font-medium"}>
                        {p.kind === "refund" ? "Refund" : "Payment"} · {paymentMethodLabel[p.method]}
                      </span>
                      {p.reference && <span className="text-muted"> · {p.reference}</span>}
                      <div className="text-xs text-muted">{formatDateTime(p.recorded_at, tz)} · {who(p.recorded_by)}{p.note && ` · ${p.note}`}</div>
                    </div>
                    <span className={p.kind === "refund" ? "text-danger" : ""}>
                      {p.kind === "refund" ? "−" : ""}{formatPaise(p.amount_paise)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-4 text-sm text-muted">No payments recorded.</p>
            )}
            <PaymentForm
              key={`${order.version}`}
              orderId={order.id}
              balancePaise={balance}
              refundablePaise={refundable}
              isAdmin={isAdmin}
              acceptsPayments={!["rejected", "cancelled"].includes(order.status)}
            />
          </Card>

          <Card>
            <h2 className="mb-3 text-lg font-semibold">GST bill</h2>
            <BillPanel
              key={`b-${order.version}`}
              orderId={order.id}
              canBill={["confirmed", "preparing", "ready", "completed"].includes(order.status)}
              isAdmin={isAdmin}
              bill={bill ? { id: bill.id, number: bill.bill_number, totalPaise: bill.total_paise, issuedAt: formatDateTime(bill.issued_at, tz) } : null}
              credits={(bill?.credit_notes ?? []).map((c) => ({ id: c.id, number: c.credit_note_number, totalPaise: c.total_paise, reason: c.reason, issuedLabel: formatDateTime(c.issued_at, tz) }))}
            />
          </Card>

          {tickets.length > 0 && (
            <Card className="lg:col-span-2">
              <h2 className="mb-3 text-lg font-semibold">Kitchen</h2>
              <div className="grid gap-4 xl:grid-cols-2">
                {tickets.map((t) =>
                  t.status === "cancelled" && !t.stop_work_acknowledged_at ? (
                    <StopWorkNotice key={t.id} ticket={t} tz={tz} mode={isAdmin ? "admin" : "view"} />
                  ) : (
                    <TicketCard key={t.id} ticket={t} tz={tz} mode={isAdmin ? "admin" : "view"} nowIso={new Date().toISOString()} />
                  ),
                )}
              </div>
            </Card>
          )}
          <Card className="lg:col-span-2">
            <h2 className="mb-3 text-lg font-semibold">Timeline</h2>
            <ol className="flex flex-col gap-3 border-l-2 border-line pl-4 text-sm">
              {(events ?? []).map((e) => {
                const data = (e.data ?? {}) as Record<string, unknown>;
                return (
                  <li key={e.id}>
                    <p className="font-medium">{eventLabel[e.event_type] ?? e.event_type}</p>
                    <p className="text-xs text-muted">{formatDateTime(e.occurred_at, tz)} · {who(e.actor_id)}</p>
                    {e.event_type === "rescheduled" && typeof data.from === "string" && typeof data.to === "string" && (
                      <p className="text-xs">{formatDateTime(data.from, tz)} → {formatDateTime(data.to, tz)}</p>
                    )}
                    {e.event_type === "items_changed" && Array.isArray(data.changes) && (
                      <ul className="text-xs">
                        {(data.changes as { item: string; from: number; to: number; notes?: string }[]).map((c, n) => (
                          <li key={n}>
                            {c.item}: {c.from === 0 ? `added ${c.to}` : c.to === 0 ? `removed ${c.from}` : c.from === c.to ? "notes changed" : `${c.from} → ${c.to}`}
                            {c.notes !== undefined && c.from !== c.to && " (notes changed)"}
                          </li>
                        ))}
                        {typeof data.total_from === "number" && typeof data.total_to === "number" && (
                          <li>Total {formatPaise(data.total_from)} → {formatPaise(data.total_to)}</li>
                        )}
                      </ul>
                    )}
                    {e.event_type === "tickets_revised" && Array.isArray(data.tickets) && (
                      <ul className="text-xs">
                        {(data.tickets as { ticket?: string; kitchen?: string; changes?: unknown }[]).map((t, n) => (
                          <li key={n}>
                            <span className="font-mono">{t.ticket}</span>
                            {t.kitchen && ` · ${t.kitchen}`}:{" "}
                            {parseTicketChanges(t.changes).map((c) => describeChange(c, (iso) => formatDateTime(iso, tz))).join("; ")}
                          </li>
                        ))}
                      </ul>
                    )}
                    {e.event_type === "ticket_changes_acknowledged" && (
                      <p className="text-xs">
                        {parseTicketChanges(data.changes).map((c) => describeChange(c, (iso) => formatDateTime(iso, tz))).join("; ")}
                      </p>
                    )}
                    {typeof data.no_show_count === "number" && (
                      <p className="text-xs">Customer now has {data.no_show_count} no-show{data.no_show_count === 1 ? "" : "s"}</p>
                    )}
                    {typeof data.ticket === "string" && (
                      <p className="font-mono text-xs">
                        {data.ticket}
                        {typeof data.kitchen === "string" && ` · ${data.kitchen}`}
                      </p>
                    )}
                    {e.event_type === "packed" && typeof data.note === "string" && <p className="text-xs">Note: {data.note}</p>}
                    {e.event_type === "handed_over" && typeof data.collected_by === "string" && (
                      <p className="text-xs">Collected by {data.collected_by}</p>
                    )}
                    {e.event_type === "handed_over" && typeof data.balance_paise === "number" && (
                      <p className="text-xs">On credit: {formatPaise(data.balance_paise)} due</p>
                    )}
                    {e.event_type === "ready_count_corrected" && typeof data.line === "string" && (
                      <p className="text-xs">{data.line}: {String(data.from)} → {String(data.to)} ready</p>
                    )}
                    {typeof data.kind === "string" && typeof data.note === "string" && (
                      <p className="text-xs">{data.kind}: {data.note}</p>
                    )}
                    {typeof data.amount_paise === "number" && <p className="text-xs">{formatPaise(data.amount_paise)}</p>}
                    {typeof data.bill_number === "string" && <p className="font-mono text-xs">{data.bill_number}</p>}
                    {typeof data.credit_note_number === "string" && <p className="font-mono text-xs">{data.credit_note_number}</p>}
                    {(["slot", "lead_time", "capacity"] as const).map((k) =>
                      typeof data[k] === "string" ? <p key={k} className="text-xs">Overrode: {data[k] as string}</p> : null,
                    )}
                    {e.event_type === "rescheduled" && typeof data.override === "string" && (
                      <p className="text-xs">Override reason: {data.override}</p>
                    )}
                    {e.reason && <p className="text-xs">Reason: {e.reason}</p>}
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
