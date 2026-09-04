import assert from "node:assert/strict";
import test from "node:test";
import { createSecret, matchTotpCounter, provisioningUri, verifyTotp } from "../server/totp.mjs";

test("verifies the six-digit form of the RFC 6238 SHA-1 vector", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(verifyTotp(secret, "287082", 59_000), true);
  assert.equal(matchTotpCounter(secret, "287082", 59_000), 1);
  assert.equal(verifyTotp(secret, "000000", 59_000), false);
});

test("creates authenticator-compatible setup data", () => {
  const secret = createSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.match(provisioningUri("trader@example.com", secret), /^otpauth:\/\/totp\//);
  assert.match(provisioningUri("trader@example.com", secret), new RegExp(`secret=${secret}`));
});
