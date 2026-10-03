import { test } from "node:test";
import assert from "node:assert/strict";
import { hashDeviceToken, newDeviceToken } from "./pin-cookie.ts";

test("device tokens are random and only their SHA-256 is stored", () => {
  const a = newDeviceToken();
  const b = newDeviceToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.match(hashDeviceToken(a), /^[0-9a-f]{64}$/);
  assert.equal(hashDeviceToken(a), hashDeviceToken(a));
  assert.notEqual(hashDeviceToken(a), hashDeviceToken(b));
});
