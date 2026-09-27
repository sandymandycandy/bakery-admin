import type { PostgrestError } from "@supabase/supabase-js";
import type { Enums } from "@/lib/database.types";

export type OrderStatus = Enums<"order_status">;
export type OrderSource = Enums<"order_source">;
export type PaymentMethod = Enums<"payment_method">;

export const statusLabel: Record<OrderStatus, string> = {
  draft: "Draft",
  pending_confirmation: "Pending confirmation",
  confirmed: "Confirmed",
  preparing: "Preparing",
  ready: "Ready",
  completed: "Completed",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export const statusTone: Record<OrderStatus, "neutral" | "brand" | "ok" | "warn" | "danger"> = {
  draft: "neutral",
  pending_confirmation: "warn",
  confirmed: "brand",
  preparing: "brand",
  ready: "ok",
  completed: "neutral",
  rejected: "danger",
  cancelled: "danger",
};

export const sourceLabel: Record<OrderSource, string> = {
  IN_STORE: "In-store",
  ONLINE: "Online",
  CALL: "Call",
};

export const paymentMethodLabel: Record<PaymentMethod, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  bank_transfer: "Bank transfer",
  other: "Other",
};

export const OPEN_STATUSES: OrderStatus[] = ["draft", "pending_confirmation", "confirmed", "preparing", "ready"];

export type RpcFailure = { ok?: false; message?: string; kind?: string };

// Order functions raise staff-facing messages with a category in `hint` (see migration 0200).
export function rpcError(error: PostgrestError): RpcFailure {
  if (error.code === "P0001") {
    return { message: error.message, kind: error.hint ?? "validation" };
  }
  if (error.code === "42501") return { message: "You do not have permission to do this.", kind: "forbidden" };
  return { message: `Something went wrong: ${error.message}`, kind: "error" };
}

export const OVERRIDABLE_KINDS = new Set(["slot", "lead_time", "blocked"]);
