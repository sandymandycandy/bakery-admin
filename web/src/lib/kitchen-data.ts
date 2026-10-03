import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { parseTicketChanges, type KitchenTicket } from "@/lib/kitchen";

type Client = Awaited<ReturnType<typeof createClient>>;

// Everything a ticket card shows. No prices or customer data exist on these tables.
const TICKET_SELECT =
  "id, order_id, kitchen_id, reference, revision, source, status, due_at, start_by, revised_at, ready_at, cancel_reason, cancelled_at, stop_work_acknowledged_at, print_count, pending_changes, changes_acknowledged_at, kitchen_ticket_lines(id, line_no, product_name, variant_name, quantity, ready_quantity, is_veg, contains_egg, is_eggless, allergens, notes, lead_time_minutes, status), kitchen_issues(id, line_id, kind, note, reported_at, resolved_at, resolution)";

// Tickets the signed-in staff member may see (RLS limits chefs to their kitchens). Add filters, then
// pass the result's data to toKitchenTickets.
export function ticketsQuery(supabase: Client) {
  return supabase.from("kitchen_tickets").select(TICKET_SELECT);
}

type TicketRows = NonNullable<Awaited<ReturnType<typeof ticketsQuery>>["data"]>;

export function toKitchenTickets(rows: TicketRows | null): KitchenTicket[] {
  return (rows ?? []).map(({ kitchen_ticket_lines, kitchen_issues, pending_changes, ...ticket }) => ({
    ...ticket,
    pending_changes: parseTicketChanges(pending_changes),
    lines: [...kitchen_ticket_lines].sort((a, b) => a.line_no - b.line_no),
    issues: [...kitchen_issues].sort((a, b) => a.reported_at.localeCompare(b.reported_at)),
  }));
}

// Changes whenever any visible ticket that could be on screen changes: every ticket write touches
// updated_at, and public.ticket_stamp() digests those values (row-level security limits a chef to
// their kitchens). The chef screen compares it every 10 seconds and reloads only when it differs.
export async function ticketStamp(supabase: Client): Promise<string> {
  const { data, error } = await supabase.rpc("ticket_stamp");
  if (error) throw new Error(error.message);
  return data;
}
