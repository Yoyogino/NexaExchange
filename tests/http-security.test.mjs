import test from "node:test";
import assert from "node:assert/strict";
import { apiNoStore, assertProxyConfiguration, requireHttps, securityHeaders } from "../server/http-security.mjs";

function response() {
  return {
    headers: new Map(),
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers.set(name, value); },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

test("security headers protect framing, content types, and browser capabilities", () => {
  const res = response();
  let continued = false;
  securityHeaders({ production: true })({}, res, () => { continued = true; });
  assert.equal(continued, true);
  assert.equal(res.headers.get("X-Frame-Options"), "DENY");
  assert.match(res.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
  assert.match(res.headers.get("Strict-Transport-Security"), /max-age=31536000/);
});

test("production rejects non-HTTPS requests", () => {
  const res = response();
  requireHttps({ production: true })({ secure: false }, res, () => assert.fail("must not continue"));
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "HTTPS is required." });
});

test("local development permits HTTP and production requires explicit proxy trust", () => {
  let continued = false;
  requireHttps({ production: false })({ secure: false }, response(), () => { continued = true; });
  assert.equal(continued, true);
  assert.doesNotThrow(() => assertProxyConfiguration({ NODE_ENV: "development" }));
  assert.throws(() => assertProxyConfiguration({ NODE_ENV: "production" }), /TRUST_PROXY=1/);
  assert.doesNotThrow(() => assertProxyConfiguration({ NODE_ENV: "production", TRUST_PROXY: "1" }));
});

test("API responses prohibit browser and intermediary caching", () => {
  const res = response();
  let continued = false;
  apiNoStore()({}, res, () => { continued = true; });
  assert.equal(continued, true);
  assert.equal(res.headers.get("Cache-Control"), "no-store, max-age=0");
  assert.equal(res.headers.get("Pragma"), "no-cache");
  assert.equal(res.headers.get("Expires"), "0");
});
