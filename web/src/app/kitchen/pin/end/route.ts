import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { clearPinSession } from "@/lib/kitchen-device";

export const dynamic = "force-dynamic";

// Ends a PIN session that is no longer valid (tablet revoked, PIN reset) and returns to the chef
// picker. A route handler, because server components cannot change cookies.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  await clearPinSession();
  return NextResponse.redirect(new URL("/kitchen/pin", request.url));
}
