import assert from "node:assert/strict";
import test from "node:test";
import { parseLoadOptions, summarizeLoad } from "../scripts/load-test.mjs";

test("load test requires explicit simulated-only confirmation", () => {
  assert.throws(() => parseLoadOptions({}), /simulated-only/);
});

test("load test restricts unsafe targets and excessive load", () => {
  const base = { LOAD_TEST_CONFIRM: "simulated-only" };
  assert.throws(() => parseLoadOptions({ ...base, LOAD_TEST_URL: "http://remote.test" }), /HTTPS/);
  assert.throws(() => parseLoadOptions({ ...base, LOAD_TEST_CONCURRENCY: "101" }), /1 to 100/);
  assert.throws(() => parseLoadOptions({ ...base, LOAD_TEST_DURATION_SECONDS: "1801" }), /5 to 1800/);
});

test("load test reports latency percentiles and error rate", () => {
  assert.deepEqual(summarizeLoad({ successes: 3, failures: 1, latencies: [30, 10, 20], liveEvents: 7, streamReconnects: 2 }), {
    requests: 4, successes: 3, failures: 1, errorRate: 0.25, p50Ms: 20, p95Ms: 30, liveEvents: 7, streamReconnects: 2,
  });
});
