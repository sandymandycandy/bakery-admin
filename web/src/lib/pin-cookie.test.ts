import { test } from "node:test";
import assert from "node:assert/strict";
import { hashDeviceToken, newDeviceToken, readPinSession, signPinSession } from "./pin-cookie.ts";

const secret = "sb_secret_test_value";
const session = { deviceId: "11111111-1111-1111-1111-111111111111", userId: "22222222-2222-2222-2222-222222222222", signedInAt: "2026-10-03T10:00:00.000Z" };

test("a signed PIN session reads back", () => {
  assert.deepEqual(readPinSession(signPinSession(session, secret), secret), session);
});

test("an edited payload, an edited signature or another secret is rejected", () => {
  const value = signPinSession(session, secret);
  const [payload, sig] = value.split(".");
  const other = Buffer.from(JSON.stringify({ ...session, userId: "33333333-3333-3333-3333-333333333333" })).toString("base64url");
  assert.equal(readPinSession(`${other}.${sig}`, secret), null);
  assert.equal(readPinSession(`${payload}.${sig.slice(0, -2)}xx`, secret), null);
  assert.equal(readPinSession(value, "another_secret"), null);
});

test("malformed values are rejected, not thrown", () => {
  for (const v of [undefined, "", "abc", "a.b.c", ".", `${Buffer.from("not json").toString("base64url")}.x`]) {
    assert.equal(readPinSession(v, secret), null);
  }
  const noDate = signPinSession({ ...session, signedInAt: "yesterday" }, secret);
  assert.equal(readPinSession(noDate, secret), null);
});

test("device tokens are random and only their SHA-256 is stored", () => {
  const a = newDeviceToken();
  const b = newDeviceToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.match(hashDeviceToken(a), /^[0-9a-f]{64}$/);
  assert.equal(hashDeviceToken(a), hashDeviceToken(a));
  assert.notEqual(hashDeviceToken(a), hashDeviceToken(b));
});
