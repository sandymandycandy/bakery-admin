import { NextResponse, type NextRequest } from "next/server";
import { getStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { pinSessionStatus } from "@/lib/kitchen-device";

export const dynamic = "force-dynamic";

// Ends a PIN login that is no longer valid (tablet revoked, PIN reset) and returns to the chef picker.
// A route handler, because server components cannot change cookies. It signs out only a login the
// database says is invalid, so a link from another site cannot sign a working tablet out.
export async function GET(request: NextRequest) {
  const staff = await getStaff();
  if (staff && (await pinSessionStatus(staff.sessionId)) === "invalid") {
    await (await createClient()).auth.signOut({ scope: "local" });
  } else if (staff) {
    return NextResponse.redirect(new URL(staff.role === "chef" ? "/kitchen" : "/admin", request.url));
  }
  return NextResponse.redirect(new URL("/kitchen/pin", request.url));
}
