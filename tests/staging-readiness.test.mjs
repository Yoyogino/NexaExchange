import assert from "node:assert/strict";
import test from "node:test";
import { waitForStaging } from "../scripts/wait-for-staging.mjs";

function response(status, body = {}) {
  return { status, async json() { return body; } };
}

test("staging readiness retries until HTTPS and both dependencies are healthy", async () => {
  let clock = 0;
  let calls = 0;
  const responses = [response(503), response(200, { database: "ok", redis: "error" }), response(200, { database: "ok", redis: "ok" })];
  const result = await waitForStaging({
    baseUrl: "https://staging.example.test/",
    timeoutMs: 100,
    intervalMs: 10,
    now: () => clock,
    delay: async (milliseconds) => { clock += milliseconds; },
    fetchImpl: async () => responses[calls++],
  });
  assert.deepEqual(result, { attempts: 3 });
  assert.equal(calls, 3);
});

test("staging readiness fails within its bounded deadline", async () => {
  let clock = 0;
  await assert.rejects(
    waitForStaging({
      baseUrl: "https://staging.example.test",
      timeoutMs: 25,
      intervalMs: 10,
      now: () => clock,
      delay: async (milliseconds) => { clock += milliseconds; },
      fetchImpl: async () => response(503),
    }),
    /within 1 seconds after 3 attempts \(HTTP 503\)/,
  );
});
