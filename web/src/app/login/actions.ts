"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { homePathFor } from "@/lib/auth";
import type { ActionState } from "@/components/form-status";

const schema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
  next: z.string().optional(),
});

// Only allow redirects back into the staff area.
function safeNext(next: string | undefined) {
  return next && /^\/(admin|kitchen)(\/|$)/.test(next) ? next : null;
}

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { message: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error || !data.user) {
    return { message: "Email or password is incorrect." };
  }

  const { data: profile } = await supabase
    .from("staff_profiles")
    .select("role, is_active")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (!profile || !profile.is_active) {
    await supabase.auth.signOut();
    return { message: "This account does not have active staff access. Ask an admin." };
  }

  const home = homePathFor(profile.role);
  const next = safeNext(parsed.data.next);
  // Chefs never land in the admin area, whatever the link said.
  redirect(next && next.startsWith(home) ? next : home);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
