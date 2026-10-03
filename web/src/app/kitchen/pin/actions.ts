"use server";

import { z } from "zod";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { deviceTokenHash, pinSignInAvailable, setPinSession } from "@/lib/kitchen-device";

const NOT_ACCEPTED = "PIN not accepted. Try again, or ask an admin to reset it.";

const input = z.object({ userId: z.uuid(), pin: z.string().regex(/^[0-9]{4,6}$/) });

// Signs a chef in on a registered tablet: the database checks the tablet, the chef's kitchen and the
// PIN (service role), then the server opens a normal session for the chef without a password.
export async function pinSignIn(userId: string, pin: string): Promise<{ ok?: true; message?: string }> {
  if (!pinSignInAvailable()) return { message: "PIN sign-in is not set up on this server yet." };
  const parsed = input.safeParse({ userId, pin });
  if (!parsed.success) return { message: NOT_ACCEPTED };
  const hash = await deviceTokenHash();
  if (!hash) return { message: "This browser is not a registered kitchen tablet." };

  const admin = createAdminClient();
  const { data: check, error } = await admin.rpc("verify_kitchen_pin", {
    p_token_hash: hash,
    p_user_id: parsed.data.userId,
    p_pin: parsed.data.pin,
  });
  const result = (check ?? {}) as { ok?: boolean; device_id?: string; signed_in_at?: string };
  if (error) return { message: "Could not check the PIN. Check the connection and try again." };
  if (!result.ok || !result.device_id || !result.signed_in_at) return { message: NOT_ACCEPTED };

  const { data: user } = await admin.auth.admin.getUserById(parsed.data.userId);
  const email = user?.user?.email;
  if (!email) return { message: NOT_ACCEPTED };
  // A one-time sign-in link made and used on the server (nothing is emailed), so the chef gets the
  // same kind of session as with a password, with row-level security applied as them.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError || !link?.properties?.hashed_token) return { message: "Could not sign in. Try again." };
  const supabase = await createClient();
  const { error: otpError } = await supabase.auth.verifyOtp({ type: "email", token_hash: link.properties.hashed_token });
  if (otpError) return { message: "Could not sign in. Try again." };

  await setPinSession({ deviceId: result.device_id, userId: parsed.data.userId, signedInAt: result.signed_in_at });
  return { ok: true };
}
