import { NextResponse } from "next/server";
import { getStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ticketStamp } from "@/lib/kitchen-data";

export const dynamic = "force-dynamic";

// Change stamp for the chef screen's 10-second check. A plain GET (not a server action) so a slow
// request never queues the chef's taps behind it, and the client can time it out.
export async function GET() {
  const staff = await getStaff();
  if (!staff) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  try {
    return NextResponse.json({ stamp: await ticketStamp(await createClient()) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
