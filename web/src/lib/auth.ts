import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/lib/database.types";

export type StaffRole = Enums<"staff_role">;

export type Staff = {
  userId: string;
  sessionId: string | null; // Supabase login session (used to recognise kitchen-tablet PIN logins)
  email: string | null;
  fullName: string;
  role: StaffRole;
  kitchens: { id: string; code: string; name: string }[];
};

// The signed-in, active staff member for this request, or null.
export const getStaff = cache(async (): Promise<Staff | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;

  const { data: profile } = await supabase
    .from("staff_profiles")
    .select("full_name, role, is_active, staff_kitchens(kitchens(id, code, name))")
    .eq("user_id", claims.sub)
    .maybeSingle();
  if (!profile || !profile.is_active) return null;

  return {
    userId: claims.sub,
    sessionId: typeof claims.session_id === "string" ? claims.session_id : null,
    email: typeof claims.email === "string" ? claims.email : null,
    fullName: profile.full_name,
    role: profile.role,
    kitchens: profile.staff_kitchens.flatMap((sk) => (sk.kitchens ? [sk.kitchens] : [])),
  };
});

export function homePathFor(role: StaffRole) {
  return role === "chef" ? "/kitchen" : "/admin";
}

// For pages and layouts: redirects when the visitor lacks one of the allowed roles.
export async function requireRole(allowed: StaffRole[]): Promise<Staff> {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  if (!allowed.includes(staff.role)) redirect(homePathFor(staff.role));
  return staff;
}

// For server actions: returns the staff member or throws; never trust the page that rendered the form.
export async function assertRole(allowed: StaffRole[]): Promise<Staff> {
  const staff = await getStaff();
  if (!staff || !allowed.includes(staff.role)) {
    throw new Error("You do not have permission to do this.");
  }
  return staff;
}
