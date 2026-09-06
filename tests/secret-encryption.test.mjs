import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { decryptSecret, encryptSecret } from "../server/secret-encryption.mjs";

test("encrypts authenticator secrets with authenticated encryption", () => {
  const key = crypto.randomBytes(32);
  const encrypted = encryptSecret("JBSWY3DPEHPK3PXP", key);
  assert.match(encrypted, /^enc:v1:/);
  assert.equal(encrypted.includes("JBSWY3DPEHPK3PXP"), false);
  assert.equal(decryptSecret(encrypted, key), "JBSWY3DPEHPK3PXP");
});

test("rejects tampered ciphertext and preserves legacy plaintext for migration", () => {
  const key = crypto.randomBytes(32);
  const encrypted = encryptSecret("SECRET", key);
  const parts = encrypted.split(":");
  const ciphertext = Buffer.from(parts[4], "base64url");
  ciphertext[0] ^= 1;
  parts[4] = ciphertext.toString("base64url");
  assert.throws(() => decryptSecret(parts.join(":"), key));
  assert.equal(decryptSecret("LEGACYSECRET", key), "LEGACYSECRET");
});
