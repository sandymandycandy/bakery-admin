// Kitchen tablet cookie (5D). Pure Node crypto: imported by unit tests, so no "@/" imports.
//
// kitchen_device: a random token that marks a registered tablet; the database stores only its SHA-256.
// Which logins were opened by PIN, and whether they may continue, is kept in the database
// (kitchen_pin_sessions), not in a cookie.
import { createHash, randomBytes } from "node:crypto";

export const DEVICE_COOKIE = "kitchen_device";

export function newDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
