import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { sourceLabel } from "@/lib/orders";
import { formatDateTime, formatTime } from "@/lib/time";
import { ticketsQuery, toKitchenTickets } from "@/lib/kitchen-data";
import { describeChange } from "@/lib/kitchen";
import { PrintButton } from "../../print-button";

export const metadata: Metadata = { title: "Kitchen ticket" };

// 80mm kitchen ticket. No prices. Opened by the Print button after the print is counted, so a
// count above 1 means this is a reprint (COPY). RLS limits chefs to their own kitchens.
export default async function KitchenTicketPrintPage({ params }: PageProps<"/print/kot/[id]">) {
  await requireRole(["admin", "counter", "chef"]);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const tz = await getBusinessTimezone();

  const supabase = await createClient();
  const [ticket] = toKitchenTickets((await ticketsQuery(supabase).eq("id", id)).data);
  if (!ticket) notFound();
  const { data: kitchen } = await supabase.from("kitchens").select("name").eq("id", ticket.kitchen_id).maybeSingle();

  return (
    <div className="min-h-screen bg-canvas print:bg-white">
      <style>{`@page { size: 80mm auto; margin: 3mm; }`}</style>
      <div className="mx-auto flex w-[76mm] justify-end pt-4 print:hidden">
        <PrintButton />
      </div>
      <article className="mx-auto mt-4 w-[76mm] bg-white p-3 font-mono text-[12px] leading-snug text-black shadow print:mt-0 print:w-full print:p-0 print:shadow-none">
        {ticket.print_count > 1 && <p className="mb-1 border-2 border-black text-center text-base font-bold">COPY</p>}
        {ticket.print_count === 0 && <p className="mb-1 text-center">PREVIEW · not recorded</p>}
        <p className="text-center text-sm font-bold">KITCHEN ORDER TICKET</p>
        <p className="text-center text-lg font-bold">{ticket.reference}</p>
        <p className="text-center">
          {kitchen?.name} · {sourceLabel[ticket.source]}
        </p>
        {ticket.revision > 1 && <p className="mt-1 border-2 border-black text-center font-bold">REVISED r{ticket.revision}</p>}
        {ticket.status !== "cancelled" && ticket.pending_changes.length > 0 && (
          <div className="mt-1 border border-black p-1">
            <p className="font-bold">CHANGES:</p>
            <ul>
              {ticket.pending_changes.map((c) => (
                <li key={c.key}>- {describeChange(c, (iso) => formatDateTime(iso, tz))}</li>
              ))}
            </ul>
          </div>
        )}
        {ticket.status === "cancelled" && <p className="mt-1 border-2 border-black text-center font-bold">CANCELLED · DO NOT MAKE</p>}
        <div className="mt-2 border-y border-dashed border-black py-1">
          <p className="font-bold">Pickup: {formatDateTime(ticket.due_at, tz)}</p>
          <p>Start by: {formatTime(ticket.start_by, tz)}</p>
        </div>
        <ul>
          {/* On a cancelled ticket, lines removed by an earlier revision (quantity 0) are left out. */}
          {ticket.lines.filter((l) => l.quantity > 0 || ticket.status !== "cancelled").map((l) =>
            l.status === "cancelled" && ticket.status !== "cancelled" ? (
              <li key={l.id} className="border-b border-dashed border-black py-1 line-through">
                REMOVED: {l.product_name} — {l.variant_name}
              </li>
            ) : (
              <li key={l.id} className="border-b border-dashed border-black py-1">
                <p className="text-sm font-bold">
                  {l.quantity} × {l.product_name}
                </p>
                <p>{l.variant_name}</p>
                <p>
                  {l.is_veg ? "VEG" : "NON-VEG"} · {l.is_eggless ? "EGGLESS" : l.contains_egg ? "CONTAINS EGG" : "NO EGG"}
                </p>
                {l.allergens.length > 0 && <p>Allergens: {l.allergens.join(", ")}</p>}
                {l.notes && <p className="font-bold">Note: {l.notes}</p>}
              </li>
            ),
          )}
        </ul>
        <p className="mt-2 text-center">Printed {formatDateTime(new Date(), tz)}</p>
      </article>
    </div>
  );
}
