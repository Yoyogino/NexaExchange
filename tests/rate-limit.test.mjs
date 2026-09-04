import assert from "node:assert/strict";
import test from "node:test";
import { createRateLimit } from "../server/rate-limit.mjs";

function response() {
  return { headers: {}, statusCode: 200, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test("allows requests through the shared counter and blocks above the limit", async () => {
  let count = 0;
  const middleware = createRateLimit({ eval: async () => ++count })({ windowMs: 60_000, limit: 2, scope: "test" });
  const first = response(); let proceeded = false;
  await middleware({ ip: "127.0.0.1" }, first, () => { proceeded = true; });
  assert.equal(proceeded, true); assert.equal(first.headers["RateLimit-Remaining"], "1");
  await middleware({ ip: "127.0.0.1" }, response(), () => {});
  const blocked = response(); await middleware({ ip: "127.0.0.1" }, blocked, () => assert.fail("must be blocked"));
  assert.equal(blocked.statusCode, 429); assert.equal(blocked.headers["Retry-After"], "60");
});

test("fails safely when Redis is unavailable", async () => {
  const middleware = createRateLimit({ eval: async () => { throw new Error("offline"); } })({ windowMs: 1000, limit: 1 });
  const res = response(); await middleware({ ip: "127.0.0.1" }, res, () => assert.fail("must not proceed"));
  assert.equal(res.statusCode, 503);
});

test("supports account-scoped identities without storing the raw email in Redis keys", async () => {
  const keys = [];
  const middleware = createRateLimit({ eval: async (_script, options) => { keys.push(options.keys[0]); return 1; } })({
    windowMs: 60_000,
    limit: 2,
    scope: "login-account",
    identity: (req) => req.body.email.trim().toLowerCase(),
  });
  await middleware({ ip: "1.1.1.1", body: { email: " User@Example.com " } }, response(), () => {});
  await middleware({ ip: "2.2.2.2", body: { email: "user@example.com" } }, response(), () => {});
  await middleware({ ip: "2.2.2.2", body: { email: "other@example.com" } }, response(), () => {});
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[1], keys[2]);
  assert.equal(keys.join(" ").includes("user@example.com"), false);
});
