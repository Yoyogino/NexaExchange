import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyLoginPassword, verifyPassword } from "../server/password.mjs";

test("password hashes remain compatible and verify asynchronously", async () => {
  const stored = await hashPassword("a strong test password", "00112233445566778899aabbccddeeff");
  assert.equal(await verifyPassword("a strong test password", stored), true);
  assert.equal(await verifyPassword("the wrong password", stored), false);
});

test("malformed stored password hashes fail closed", async () => {
  assert.equal(await verifyPassword("anything", null), false);
  assert.equal(await verifyPassword("anything", "bad:value"), false);
  assert.equal(await verifyPassword("anything", "salt:not-hex"), false);
});

test("unknown-account login checks fail through the same password path", async () => {
  const stored = await hashPassword("correct password", "ffeeddccbbaa99887766554433221100");
  assert.equal(await verifyLoginPassword("correct password", stored), true);
  assert.equal(await verifyLoginPassword("correct password", null), false);
});
