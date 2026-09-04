import assert from "node:assert/strict";
import test from "node:test";
import { createCodeHasher } from "../server/code-hash.mjs";

test("low-entropy codes are protected by a keyed HMAC", () => {
  const hash = createCodeHasher(Buffer.alloc(32, 1))("123456");
  assert.match(hash, /^hmac\$[a-f0-9]{64}$/);
  assert.equal(hash.includes("123456"), false);
});

test("the same key and code are stable while different keys produce different hashes", () => {
  const first = createCodeHasher(Buffer.alloc(32, 1));
  const second = createCodeHasher(Buffer.alloc(32, 2));
  assert.equal(first("ABC-123"), first("ABC-123"));
  assert.notEqual(first("ABC-123"), second("ABC-123"));
});

test("code hashing refuses an invalid secret key", () => {
  assert.throws(() => createCodeHasher(Buffer.alloc(16)), /32-byte/);
});
