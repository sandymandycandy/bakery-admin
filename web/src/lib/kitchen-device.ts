import "server-only";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/server";
import { DEVICE_COOKIE, hashDeviceToken } from "@/lib/pin-cookie";

// Kitchen tablets (5D). The PIN check, the chef list and the login check need the service-role key
// (SUPABASE_SECRET_KEY); without it PIN sign-in is simply unavailable.

const YEAR = 400 * 24 * 60 * 60; // the longest cookie lifetime browsers keep (400 days)

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
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

// Records a login just opened by PIN, so the database can end it and recognise it later.
export async function recordPinSession(sessionId: string, deviceId: string, userId: string, signedInAt: string) {
  const { error } = await createAdminClient().rpc("record_kitchen_pin_session", {
    p_session_id: sessionId,
    p_device_id: deviceId,
    p_user_id: userId,
    p_signed_in_at: signedInAt,
  });
  return !error;
}

// For a signed-in chef's login: "none" when it was not opened by PIN (email and password), "ok"
// while it is on the tablet it was opened on, that tablet is still registered and the PIN unchanged,
// "invalid" otherwise (revoked tablet, PIN reset or removed, chef moved or deactivated, or the login
// used from another browser). Decided by the database from the login's session id, so losing or
// deleting cookies cannot turn a PIN login into an unchecked one.
export async function pinSessionStatus(sessionId: string | null): Promise<"none" | "ok" | "invalid"> {
  if (!sessionId || !pinSignInAvailable()) return "none";
  const { data, error } = await createAdminClient().rpc("kitchen_pin_session_status", {
    p_session_id: sessionId,
    p_token_hash: (await deviceTokenHash()) ?? "",
  });
  // A failed check (database or network trouble) keeps the chef signed in; only a definite "invalid"
  // ends the login (owner's choice of availability over a few seconds' delay).
  if (error) return "none";
  return data === "ok" || data === "invalid" ? data : "none";
}
