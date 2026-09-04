import assert from "node:assert/strict";
import test from "node:test";
import { runStagingSmoke } from "../scripts/staging-smoke.mjs";

function response(status, body = {}, cookies = []) {
  return {
    status,
    headers: { getSetCookie: () => cookies },
    async json() { return body; },
  };
}

const account = {
  user: { email: "smoke@example.test" },
  wallets: [{ asset: "BTC" }, { asset: "USDT" }],
};

function readOnlyResponse(path) {
  if (path === "/api/me") return response(200, account, ["nexa_session=rotated; Path=/; HttpOnly", "nexa_csrf=csrf-rotated; Path=/"]);
  if (["/api/market", "/api/orders", "/api/trades"].includes(path)) return response(200);
  return null;
}

test("staging smoke check registers once and follows rotated session cookies", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname;
    calls.push({ path, options });
    if (path === "/api/auth/register") return response(201, account, ["nexa_session=initial; Path=/; HttpOnly", "nexa_csrf=csrf-initial; Path=/"]);
    const readOnly = readOnlyResponse(path);
    if (readOnly) return readOnly;
    if (path === "/api/auth/logout") return response(204);
    throw new Error(`Unexpected request: ${path}`);
  };

  await runStagingSmoke({ baseUrl: "https://staging.example.test/", email: "smoke@example.test", password: "long-smoke-password", fetchImpl });
  const logout = calls.find((call) => call.path === "/api/auth/logout");
  assert.equal(logout.options.headers["x-csrf-token"], "csrf-rotated");
  assert.match(logout.options.headers.cookie, /nexa_session=rotated/);
  assert.equal(calls.some((call) => call.path === "/api/auth/login"), false);
});

test("staging smoke check signs into its existing dedicated account", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path === "/api/auth/register") return response(409);
    if (path === "/api/auth/login") return response(200, account, ["nexa_session=existing; Path=/; HttpOnly", "nexa_csrf=existing-csrf; Path=/"]);
    const readOnly = readOnlyResponse(path);
    if (readOnly) return readOnly;
    if (path === "/api/auth/logout") return response(204);
    throw new Error(`Unexpected request: ${path}`);
  };

  await runStagingSmoke({ baseUrl: "https://staging.example.test", email: "smoke@example.test", password: "long-smoke-password", fetchImpl });
  assert.equal(calls.filter((path) => path === "/api/auth/login").length, 1);
});
