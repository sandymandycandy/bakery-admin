import "server-only";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/server";
import { DEVICE_COOKIE, PIN_COOKIE, hashDeviceToken, readPinSession, signPinSession, type PinSession } from "@/lib/pin-cookie";

// Kitchen tablets (5D). The PIN check, the chef list and the session check need the service-role
// key (SUPABASE_SECRET_KEY); without it PIN sign-in is simply unavailable.

const YEAR = 400 * 24 * 60 * 60; // the longest cookie lifetime browsers keep (400 days)

const cookieOptions = (maxAge?: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  ...(maxAge ? { maxAge } : {}),
});

export const pinSignInAvailable = () => Boolean(env.supabaseSecretKey);

export type TabletInfo = {
  deviceId: string;
  kitchen: { id: string; name: string };
  chefs: { user_id: string; full_name: string; has_pin: boolean }[];
};

export async function deviceTokenHash(): Promise<string | null> {
  const token = (await cookies()).get(DEVICE_COOKIE)?.value;
  return token ? hashDeviceToken(token) : null;
}

// The registered tablet this browser is, with its kitchen's chefs; null when it is not one (no
// cookie, unknown or revoked tablet) or PIN sign-in is not configured.
export async function currentTablet(): Promise<TabletInfo | null> {
  if (!pinSignInAvailable()) return null;
  const hash = await deviceTokenHash();
  if (!hash) return null;
  const { data } = await createAdminClient().rpc("kitchen_device_chefs", { p_token_hash: hash });
  if (!data || typeof data !== "object") return null;
  const d = data as { device_id: string; kitchen: TabletInfo["kitchen"]; chefs: TabletInfo["chefs"] };
  return { deviceId: d.device_id, kitchen: d.kitchen, chefs: d.chefs ?? [] };
}

export async function setDeviceCookie(token: string) {
  (await cookies()).set(DEVICE_COOKIE, token, cookieOptions(YEAR));
}

export async function setPinSession(session: PinSession) {
  (await cookies()).set(PIN_COOKIE, signPinSession(session, env.supabaseSecretKey!), cookieOptions());
}

export async function clearPinSession() {
  (await cookies()).delete(PIN_COOKIE);
}

export async function hasPinSession(): Promise<boolean> {
  return Boolean((await cookies()).get(PIN_COOKIE)?.value);
}

// For a signed-in chef: "none" when they did not sign in by PIN (email and password), "ok" while the
// tablet is still registered and their PIN unchanged, "invalid" otherwise (revoked tablet, PIN reset
// or cleared, chef moved or deactivated, a forged cookie, or PIN sign-in no longer configured).
export async function pinSessionStatus(userId: string): Promise<"none" | "ok" | "invalid"> {
  const value = (await cookies()).get(PIN_COOKIE)?.value;
  if (!value) return "none";
  if (!pinSignInAvailable()) return "invalid";
  const session = readPinSession(value, env.supabaseSecretKey!);
  const hash = await deviceTokenHash();
  if (!session || !hash || session.userId !== userId) return "invalid";
  const { data, error } = await createAdminClient().rpc("kitchen_pin_session_valid", {
    p_token_hash: hash,
    p_user_id: userId,
    p_signed_in_at: session.signedInAt,
  });
  // A failed check (database or network trouble) keeps the chef signed in; only a definite "no" ends it.
  if (error) return "ok";
  return data === true ? "ok" : "invalid";
}
