"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { rpcError, type RpcFailure } from "@/lib/orders";

type Result<T = object> = ({ ok: true } & T) | ({ ok?: false } & RpcFailure);

const uuid = z.uuid();
// Admins act as the kitchen with a reason; chefs send none (the database ignores it for chefs).
const reasonArg = (reason?: string) => reason?.trim().slice(0, 300) || undefined;

function afterTicketChange() {
  revalidatePath("/kitchen");
  revalidatePath("/admin", "layout");
}

export async function acknowledgeTicketAction(ticketId: string, reason?: string): Promise<Result> {
  await assertRole(["chef", "admin"]);
  if (!uuid.safeParse(ticketId).success) return { message: "Invalid ticket." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("acknowledge_ticket", { p_ticket_id: ticketId, p_reason: reasonArg(reason) });
  if (error) return rpcError(error);
  afterTicketChange();
  return { ok: true };
}

export async function startTicketAction(ticketId: string, reason?: string): Promise<Result> {
  await assertRole(["chef", "admin"]);
  if (!uuid.safeParse(ticketId).success) return { message: "Invalid ticket." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_ticket", { p_ticket_id: ticketId, p_reason: reasonArg(reason) });
  if (error) return rpcError(error);
  afterTicketChange();
  return { ok: true };
}

export async function setLineReadyAction(lineId: string, readyQuantity: number, reason?: string): Promise<Result> {
  await assertRole(["chef", "admin"]);
  if (!uuid.safeParse(lineId).success) return { message: "Invalid item." };
  if (!Number.isInteger(readyQuantity) || readyQuantity < 0 || readyQuantity > 999) return { message: "Enter a whole number." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_line_ready", {
    p_line_id: lineId,
    p_ready_quantity: readyQuantity,
    p_reason: reasonArg(reason),
  });
  if (error) return rpcError(error);
  afterTicketChange();
  return { ok: true };
}

const issueSchema = z.object({
  ticketId: z.uuid(),
  lineId: z.uuid().nullable(),
  kind: z.enum(["ingredient", "equipment", "quality", "other"]),
  note: z.string().trim().min(3, "Describe the issue in at least 3 characters.").max(500),
});

export async function reportIssueAction(input: z.input<typeof issueSchema>): Promise<Result> {
  await assertRole(["chef", "admin"]);
  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Check the issue." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("report_issue", {
    p_ticket_id: parsed.data.ticketId,
    p_kind: parsed.data.kind,
    p_note: parsed.data.note,
    p_line_id: parsed.data.lineId ?? undefined,
  });
  if (error) return rpcError(error);
  afterTicketChange();
  return { ok: true };
}

export async function acknowledgeStopWorkAction(ticketId: string, reason?: string): Promise<Result> {
  await assertRole(["chef", "admin"]);
  if (!uuid.safeParse(ticketId).success) return { message: "Invalid ticket." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("acknowledge_stop_work", { p_ticket_id: ticketId, p_reason: reasonArg(reason) });
  if (error) return rpcError(error);
  afterTicketChange();
  return { ok: true };
}

export async function recordTicketPrintAction(ticketId: string): Promise<Result<{ count: number }>> {
  await assertRole(["chef", "admin", "counter"]);
  if (!uuid.safeParse(ticketId).success) return { message: "Invalid ticket." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_ticket_print", { p_ticket_id: ticketId });
  if (error) return rpcError(error);
  return { ok: true, count: data };
}

export async function resolveIssueAction(issueId: string, resolution: string): Promise<Result> {
  await assertRole(["admin"]);
  if (!uuid.safeParse(issueId).success) return { message: "Invalid issue." };
  const text = resolution.trim();
  if (text.length < 3 || text.length > 500) return { message: "Describe how the issue was resolved (3 to 500 characters)." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_issue", { p_issue_id: issueId, p_resolution: text });
  if (error) return rpcError(error);
  afterTicketChange();
  return { ok: true };
}
