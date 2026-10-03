// Kitchen tablet cookies (5D). Pure Node crypto: imported by unit tests, so no "@/" imports.
//
// kitchen_device: a random token that marks a registered tablet; the database stores only its SHA-256.
// kitchen_pin:    which chef signed in by PIN on which tablet, and when; HMAC-signed so it cannot be
//                 edited. /kitchen and /kitchen/stamp re-check it against the database on every load.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const DEVICE_COOKIE = "kitchen_device";
export const PIN_COOKIE = "kitchen_pin";

export type PinSession = { deviceId: string; userId: string; signedInAt: string };

export function newDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function mac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`kitchen_pin.${payload}`).digest("base64url");
}

export function signPinSession(session: PinSession, secret: string): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${mac(payload, secret)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readPinSession(value: string | undefined, secret: string): PinSession | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, sig] = parts;
  const expected = Buffer.from(mac(payload, secret));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<PinSession>;
    if (typeof s.deviceId !== "string" || !UUID.test(s.deviceId)) return null;
    if (typeof s.userId !== "string" || !UUID.test(s.userId)) return null;
    if (typeof s.signedInAt !== "string" || Number.isNaN(Date.parse(s.signedInAt))) return null;
    return { deviceId: s.deviceId, userId: s.userId, signedInAt: s.signedInAt };
  } catch {
    return null;
  }
}
