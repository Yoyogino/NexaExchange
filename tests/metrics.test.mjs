import assert from "node:assert/strict";
import test from "node:test";
import { createMetrics } from "../server/metrics.mjs";

test("aggregates request, error, latency, and normalized route metrics", () => {
  const metrics = createMetrics();
  metrics.record({ method: "GET", path: "/api/orders/2d6a2df7-8aa1-4f85-b1da-fc9d8b54469c", status: 200, durationMs: 10 });
  metrics.record({ method: "GET", path: "/api/orders/f5e82161-0122-43ea-881b-6cf12e91f608", status: 500, durationMs: 30 });
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.requests, 2); assert.equal(snapshot.errors, 1); assert.equal(snapshot.errorRate, 0.5); assert.equal(snapshot.averageDurationMs, 20); assert.equal(snapshot.slowestMs, 30);
  assert.equal(snapshot.routes[0].route, "GET /api/orders/:id"); assert.equal(snapshot.routes[0].requests, 2);
});
