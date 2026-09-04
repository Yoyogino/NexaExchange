import assert from "node:assert/strict";
import test from "node:test";
import { assertIsolatedTestDatabase } from "./helpers/test-database.mjs";

test("database tests refuse to run without the isolated runner marker", async () => {
  const pool = { query: async () => assert.fail("must reject before connecting") };
  await assert.rejects(() => assertIsolatedTestDatabase(pool, {}), /refusing to modify a non-test database/);
});

test("database tests verify the active schema matches the runner marker", async () => {
  const mismatchedPool = { query: async () => ({ rows: [{ schema: "public" }] }) };
  await assert.rejects(
    () => assertIsolatedTestDatabase(mismatchedPool, { NEXA_TEST_SCHEMA: "nexa_test_123" }),
    /schema mismatch/,
  );
  const isolatedPool = { query: async () => ({ rows: [{ schema: "nexa_test_123" }] }) };
  await assert.doesNotReject(() => assertIsolatedTestDatabase(isolatedPool, { NEXA_TEST_SCHEMA: "nexa_test_123" }));
});
