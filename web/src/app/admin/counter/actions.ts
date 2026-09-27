"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { rpcError, type RpcFailure } from "@/lib/orders";

const saleSchema = z.object({
  idempotencyKey: z.uuid(),
  items: z.array(z.object({ variantId: z.uuid(), quantity: z.number().int().min(1).max(999) })).min(1, "Add at least one item.").max(50),
  payments: z
    .array(
      z.object({
        method: z.enum(["cash", "upi", "card", "bank_transfer", "other"]),
        amountPaise: z.number().int().min(0),
        reference: z.string().max(100).optional(),
      }),
    )
    .max(4),
  discount: z
    .object({ kind: z.enum(["amount", "percent"]), value: z.number().int().min(0), reason: z.string().max(300) })
    .optional(),
  customerName: z.string().max(80).optional(),
  customerPhone: z.string().max(20).optional(),
});

export type CounterSaleInput = z.input<typeof saleSchema>;
type SaleResult = { ok: true; orderId: string; billId: string; billNumber: string; reference: string; totalPaise: number } | RpcFailure;

export async function counterSaleAction(input: CounterSaleInput): Promise<SaleResult> {
  await assertRole(["admin", "counter"]);
  const parsed = saleSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Check the sale." };
  const d = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("counter_sale", {
    p_idempotency_key: d.idempotencyKey,
    p_items: d.items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity })),
    p_payments: d.payments.map((p) => ({ method: p.method, amount_paise: p.amountPaise, reference: p.reference ?? null })),
    p_discount_kind: d.discount?.kind,
    p_discount_value: d.discount?.value,
    p_discount_reason: d.discount?.reason || undefined,
    p_customer_name: d.customerName?.trim() || undefined,
    p_customer_phone: d.customerPhone?.trim() || undefined,
  });
  if (error) return rpcError(error);

  const result = data as { order_id: string; bill_id: string; bill_number: string; reference: string; total_paise: number };
  revalidatePath("/admin", "layout");
  return {
    ok: true,
    orderId: result.order_id,
    billId: result.bill_id,
    billNumber: result.bill_number,
    reference: result.reference,
    totalPaise: result.total_paise,
  };
}
