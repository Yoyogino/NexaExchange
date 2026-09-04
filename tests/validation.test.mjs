import assert from "node:assert/strict";
import test from "node:test";
import * as V from "../server/validation.mjs";

test("normalizes valid emails and rejects malformed or oversized addresses", () => {
  assert.equal(V.email("  Trader@Example.COM "), "trader@example.com");
  assert.throws(() => V.email("not-an-email"), V.ValidationError);
  assert.throws(() => V.email(`${"a".repeat(250)}@x.test`), V.ValidationError);
});

test("enforces password, UUID, boolean, code, and text boundaries", () => {
  assert.equal(V.password("correct-horse"), "correct-horse");
  assert.throws(() => V.password("short"), V.ValidationError);
  assert.equal(V.uuid("2d6a2df7-8aa1-4f85-b1da-fc9d8b54469c"), "2d6a2df7-8aa1-4f85-b1da-fc9d8b54469c");
  assert.throws(() => V.uuid("not-a-uuid"), V.ValidationError);
  assert.equal(V.boolean(false, "Disabled"), false);
  assert.throws(() => V.boolean("false", "Disabled"), V.ValidationError);
  assert.equal(V.shortCode("ABC123-DEF"), "ABC123-DEF");
  assert.equal(V.text("  reviewed adjustment  ", "Reason", 30), "reviewed adjustment");
});
