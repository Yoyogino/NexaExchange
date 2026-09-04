import test from "node:test";
import assert from "node:assert/strict";
import { assertMonitoringConfiguration, createMonitoringHandler } from "../server/monitoring.mjs";

function response() {
  return { statusCode: 200, body: "", contentType: "", status(code) { this.statusCode = code; return this; }, end() { return this; }, type(value) { this.contentType = value; return this; }, send(value) { this.body = value; return this; } };
}
const metrics = { snapshot: () => ({ requests: 12, errors: 2, totalDurationMs: 345, uptimeSeconds: 60 }) };
const pool = { query: async () => ({ rows: [{ "?column?": 1 }] }) };
const redis = { ping: async () => "PONG" };

test("monitoring endpoint hides itself when its dedicated token is absent or wrong", async () => {
  for (const authorization of [undefined, "Bearer wrong"]) {
    const res = response();
    await createMonitoringHandler({ metrics, pool, redis, token: "correct" })({ get: () => authorization }, res, assert.fail);
    assert.equal(res.statusCode, 404);
  }
});

test("monitoring endpoint exports dependency, request, latency, and process metrics", async () => {
  const res = response();
  await createMonitoringHandler({ metrics, pool, redis, token: "correct" })({ get: () => "Bearer correct" }, res, assert.fail);
  assert.match(res.contentType, /text\/plain/);
  assert.match(res.body, /nexa_dependency_up\{dependency="postgres"\} 1/);
  assert.match(res.body, /nexa_http_requests_total 12/);
  assert.match(res.body, /nexa_http_request_duration_milliseconds_total 345/);
});

test("production requires a separate monitoring token", () => {
  assert.throws(() => assertMonitoringConfiguration({ NODE_ENV: "production" }), /MONITORING_TOKEN/);
  assert.doesNotThrow(() => assertMonitoringConfiguration({ NODE_ENV: "production", MONITORING_TOKEN: "secret" }));
});
