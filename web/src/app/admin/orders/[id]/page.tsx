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
import { Alert, Badge, Card, PageHeader, VegMark } from "@/components/ui";
import { SourceBadge, StatusBadge } from "@/components/order-badges";
import { OrderActions, PaymentForm } from "./order-actions";
import { BillPanel, DiscountForm } from "./billing-panel";

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
  bill_issued: "GST bill issued",
  credit_note_issued: "Credit note issued",
  completed: "Completed",
};

export default async function OrderPage({ params, searchParams }: PageProps<"/admin/orders/[id]">) {
  const staff = await requireRole(["admin", "counter"]);
  const isAdmin = staff.role === "admin";
  const { id } = await params;
  const { created } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const tz = await getBusinessTimezone();

  const supabase = await createClient();
  const [{ data: order }, { data: items }, { data: payments }, { data: events }, { data: kitchens }, { data: staffRows }, { data: bill }, { data: settings }] =
    await Promise.all([
      supabase.from("order_summaries").select("*").eq("id", id).maybeSingle(),
      supabase.from("order_items").select("*").eq("order_id", id).order("line_no"),
      supabase.from("payments").select("*").eq("order_id", id).order("recorded_at"),
      supabase.from("order_events").select("*").eq("order_id", id).order("occurred_at"),
      supabase.from("kitchens").select("id, name"),
      supabase.from("staff_profiles").select("user_id, full_name"),
      supabase.from("bills").select("id, bill_number, total_paise, issued_at, credit_notes(id, credit_note_number, total_paise, reason, issued_at)").eq("order_id", id).maybeSingle(),
      supabase.from("business_settings").select("counter_discount_limit_bps").single(),
    ]);
  if (!order || !order.id || !order.status || !order.source) notFound();

  const kitchenName = new Map((kitchens ?? []).map((k) => [k.id, k.name]));
  const staffName = new Map((staffRows ?? []).map((s) => [s.user_id, s.full_name]));
  const who = (userId: string | null) => (userId ? staffName.get(userId) ?? "Staff" : "System");
  const balance = order.balance_paise ?? 0;
  const refundable = (order.paid_paise ?? 0) - (order.refunded_paise ?? 0);
  const closed = ["completed", "rejected", "cancelled"].includes(order.status);
  const unmapped = (items ?? []).filter((i) => i.prep_type === "made_to_order" && !i.kitchen_id);

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
          </span>
        }
      />

      <div className="flex flex-col gap-6">
        {created === "1" && (
          <Alert tone="ok" title={order.status === "confirmed" ? "Order created and confirmed" : "Order created"}>
            {order.status === "pending_confirmation" ? "It is waiting for confirmation before any kitchen work is released." : "Kitchen tickets will be generated from confirmed orders in Phase 5."}
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
            <ul className="divide-y divide-line">
              {(items ?? []).map((i) => (
                <li key={i.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {i.quantity - i.cancelled_quantity} × {i.product_name} — {i.variant_name}
                    </p>
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
              ))}
            </ul>
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
                <dd className="font-medium">{order.customer_name ?? "Walk-in"}</dd>
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
