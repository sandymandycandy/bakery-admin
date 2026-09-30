"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { zonedLocalToDate } from "@/lib/time";
import { parseRupeesToPaise } from "@/lib/money";
import { rpcError, type RpcFailure } from "@/lib/orders";
import type { PickupAvailability } from "@/lib/capacity";

type Result<T = object> = ({ ok: true } & T) | ({ ok?: false } & RpcFailure);

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => v.trim() || undefined)
    .optional();

const createSchema = z.object({
  idempotencyKey: z.uuid(),
  source: z.enum(["IN_STORE", "CALL"]),
  items: z
    .array(
      z.object({
        variantId: z.uuid(),
        quantity: z.number().int().min(1, "Quantity must be at least 1.").max(999),
        notes: optionalText(500),
      }),
    )
    .min(1, "Add at least one item.")
    .max(50),
  customerName: optionalText(80),
  customerPhone: optionalText(20),
  dueLocal: z.string().nullable(),
  customerNotes: optionalText(1000),
  internalNotes: optionalText(1000),
  confirm: z.boolean(),
  overrideReason: optionalText(300),
});

export type CreateOrderInput = z.input<typeof createSchema>;

export async function createOrderAction(input: CreateOrderInput): Promise<Result<{ orderId: string }>> {
  await assertRole(["admin", "counter"]);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Check the order and try again." };
  const data = parsed.data;

  let dueAt: string | undefined;
  if (data.dueLocal) {
    const due = zonedLocalToDate(data.dueLocal, await getBusinessTimezone());
    if (!due) return { message: "Enter a valid pickup date and time." };
    dueAt = due.toISOString();
  }

  const supabase = await createClient();
  const { data: order, error } = await supabase.rpc("create_order", {
    p_idempotency_key: data.idempotencyKey,
    p_source: data.source,
    p_items: data.items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity, notes: i.notes ?? null })),
    p_customer_name: data.customerName,
    p_customer_phone: data.customerPhone,
    p_due_at: dueAt,
    p_customer_notes: data.customerNotes,
    p_internal_notes: data.internalNotes,
    p_confirm: data.confirm,
    p_override_reason: data.overrideReason,
  });
  if (error) return rpcError(error);

  revalidatePath("/admin", "layout");
  return { ok: true, orderId: order.id };
}

const transitionSchema = z.object({
  orderId: z.uuid(),
  version: z.number().int(),
  reason: optionalText(300),
  overrideReason: optionalText(300),
});

async function afterChange(orderId: string) {
  revalidatePath("/admin", "layout");
  revalidatePath(`/admin/orders/${orderId}`);
}

export async function confirmOrderAction(input: z.input<typeof transitionSchema>): Promise<Result> {
  await assertRole(["admin", "counter"]);
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success) return { message: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_order", {
    p_order_id: parsed.data.orderId,
    p_expected_version: parsed.data.version,
    p_override_reason: parsed.data.overrideReason,
  });
  if (error) return rpcError(error);
  await afterChange(parsed.data.orderId);
  return { ok: true };
}

export async function rejectOrderAction(input: z.input<typeof transitionSchema>): Promise<Result> {
  await assertRole(["admin"]);
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success || !parsed.data.reason) return { message: "Give a reason for rejecting the order." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_order", {
    p_order_id: parsed.data.orderId,
    p_expected_version: parsed.data.version,
    p_reason: parsed.data.reason,
  });
  if (error) return rpcError(error);
  await afterChange(parsed.data.orderId);
  return { ok: true };
}

export async function cancelOrderAction(input: z.input<typeof transitionSchema>): Promise<Result> {
  await assertRole(["admin"]);
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success || !parsed.data.reason) return { message: "Give a reason for cancelling the order." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_order", {
    p_order_id: parsed.data.orderId,
    p_expected_version: parsed.data.version,
    p_reason: parsed.data.reason,
  });
  if (error) return rpcError(error);
  await afterChange(parsed.data.orderId);
  return { ok: true };
}

export async function rescheduleOrderAction(
  input: z.input<typeof transitionSchema> & { dueLocal: string },
): Promise<Result> {
  await assertRole(["admin"]);
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success) return { message: "Invalid request." };
  if (!parsed.data.reason) return { message: "Give a reason for the new pickup time." };
  const due = zonedLocalToDate(input.dueLocal, await getBusinessTimezone());
  if (!due) return { message: "Enter a valid pickup date and time." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reschedule_order", {
    p_order_id: parsed.data.orderId,
    p_expected_version: parsed.data.version,
    p_due_at: due.toISOString(),
    p_reason: parsed.data.reason,
    p_override_reason: parsed.data.overrideReason,
  });
  if (error) return rpcError(error);
  await afterChange(parsed.data.orderId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// No-shows and customer flags (Phase 4C)
// ---------------------------------------------------------------------------

// Recording a no-show does not change the order's status (owner's decision, 2026-09-29).
export async function recordNoShowAction(input: { orderId: string; version: number }): Promise<Result> {
  await assertRole(["admin", "counter"]);
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success) return { message: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_no_show", {
    p_order_id: parsed.data.orderId,
    p_expected_version: parsed.data.version,
  });
  if (error) return rpcError(error);
  await afterChange(parsed.data.orderId);
  revalidatePath("/admin/customers", "layout");
  return { ok: true };
}

export async function undoNoShowAction(input: z.input<typeof transitionSchema>): Promise<Result> {
  await assertRole(["admin"]);
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success || !parsed.data.reason) return { message: "Give a reason for undoing the no-show." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("undo_no_show", {
    p_order_id: parsed.data.orderId,
    p_expected_version: parsed.data.version,
    p_reason: parsed.data.reason,
  });
  if (error) return rpcError(error);
  await afterChange(parsed.data.orderId);
  revalidatePath("/admin/customers", "layout");
  return { ok: true };
}

export type CustomerFlags = { id: string; name: string; isBlocked: boolean; blockedReason: string | null; noShowCount: number };

// Flags for the customer with this phone, for the warning on the new-order form. Null when
// there is no such customer or nothing to warn about.
export async function customerFlagsAction(phone: string): Promise<CustomerFlags | null> {
  await assertRole(["admin", "counter"]);
  // Same normalisation as create_order.
  const normalised = phone.replace(/[\s()-]/g, "");
  if (!/^\+?[0-9]{10,15}$/.test(normalised)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("id, full_name, is_blocked, blocked_reason, no_show_count")
    .eq("phone", normalised)
    .maybeSingle();
  if (!data || (!data.is_blocked && data.no_show_count === 0)) return null;
  return { id: data.id, name: data.full_name, isBlocked: data.is_blocked, blockedReason: data.blocked_reason, noShowCount: data.no_show_count };
}

// Window and category usage for one business-local day ("YYYY-MM-DD"). Null when it cannot be loaded.
export async function pickupAvailabilityAction(dayKey: string, excludeOrderId?: string): Promise<PickupAvailability | null> {
  await assertRole(["admin", "counter"]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null;
  if (excludeOrderId !== undefined && !z.uuid().safeParse(excludeOrderId).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pickup_availability", { p_date: dayKey, p_exclude_order: excludeOrderId });
  if (error) return null;
  return data as unknown as PickupAvailability;
}

const paymentSchema = z.object({
  orderId: z.uuid(),
  idempotencyKey: z.uuid(),
  kind: z.enum(["payment", "refund"]),
  method: z.enum(["cash", "upi", "card", "bank_transfer", "other"]),
  amount: z.string(),
  reference: optionalText(100),
  note: optionalText(500),
});

export async function recordPaymentAction(input: z.input<typeof paymentSchema>): Promise<Result> {
  await assertRole(["admin", "counter"]);
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return { message: "Check the payment details." };
  const amount = parseRupeesToPaise(parsed.data.amount);
  if (!amount) return { message: "Enter an amount in rupees, e.g. 500 or 499.50." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_payment", {
    p_order_id: parsed.data.orderId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_kind: parsed.data.kind,
    p_method: parsed.data.method,
    p_amount_paise: amount,
    p_reference: parsed.data.reference,
    p_note: parsed.data.note,
  });
  if (error) return rpcError(error);
  await afterChange(parsed.data.orderId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Discounts, bills, credit notes (Phase 4B)
// ---------------------------------------------------------------------------

const discountSchema = z.object({
  orderId: z.uuid(),
  version: z.number().int(),
  kind: z.enum(["amount", "percent"]),
  value: z.string(),
  reason: optionalText(300),
});

// "10" percent -> 1000 bps; "150.50" rupees -> 15050 paise. Null when invalid.
function parseDiscountValue(kind: "amount" | "percent", value: string): number | null {
  if (value.trim() === "") return 0;
  if (kind === "amount") return parseRupeesToPaise(value);
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  const bps = Math.round(Number(value) * 100);
  return bps <= 10000 ? bps : null;
}

export async function applyDiscountAction(input: z.input<typeof discountSchema>): Promise<Result> {
  await assertRole(["admin", "counter"]);
  const parsed = discountSchema.safeParse(input);
  if (!parsed.success) return { message: "Check the discount." };
  const value = parseDiscountValue(parsed.data.kind, parsed.data.value);
  if (value === null) return { message: parsed.data.kind === "percent" ? "Enter a percentage from 0 to 100." : "Enter an amount in rupees." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("apply_discount", {
    p_order_id: parsed.data.orderId,
    p_expected_version: parsed.data.version,
    p_kind: parsed.data.kind,
    p_value: value,
    p_reason: parsed.data.reason,
  });
  if (error) return rpcError(error);
  await afterChange(parsed.data.orderId);
  return { ok: true };
}

export async function issueBillAction(orderId: string): Promise<Result<{ billId: string }>> {
  await assertRole(["admin", "counter"]);
  if (!z.uuid().safeParse(orderId).success) return { message: "Invalid order." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_bill", { p_order_id: orderId });
  if (error) return rpcError(error);
  await afterChange(orderId);
  return { ok: true, billId: data.id };
}

const creditSchema = z.object({
  orderId: z.uuid(),
  billId: z.uuid(),
  idempotencyKey: z.uuid(),
  amount: z.string(),
  reason: z.string().trim().min(3, "Give a reason for the credit note.").max(300),
});

export async function issueCreditNoteAction(input: z.input<typeof creditSchema>): Promise<Result> {
  await assertRole(["admin"]);
  const parsed = creditSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Check the credit note." };
  const amount = parseRupeesToPaise(parsed.data.amount);
  if (!amount) return { message: "Enter an amount in rupees." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("issue_credit_note", {
    p_bill_id: parsed.data.billId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_amount_paise: amount,
    p_reason: parsed.data.reason,
  });
  if (error) return rpcError(error);
  await afterChange(parsed.data.orderId);
  return { ok: true };
}
