import test from "node:test";
import assert from "node:assert/strict";
import { SESSION_IDLE_MINUTES, sessionTokenFromRequest, shouldTouchSession } from "../server/session-policy.mjs";

test("browser sessions accept only the cookie token", () => {
  const parseCookies = () => ({ nexa_session: "cookie-token" });
  assert.equal(sessionTokenFromRequest({ headers: { authorization: "Bearer legacy-token" } }, "nexa_session", parseCookies), "cookie-token");
  assert.equal(sessionTokenFromRequest({ headers: { authorization: "Bearer legacy-token" } }, "nexa_session", () => ({})), null);
});

test("session activity is touched at a bounded interval", () => {
  const now = Date.parse("2026-09-02T12:10:00Z");
  assert.equal(shouldTouchSession("2026-09-02T12:04:59Z", now), true);
  assert.equal(shouldTouchSession("2026-09-02T12:06:00Z", now), false);
  assert.equal(SESSION_IDLE_MINUTES, 30);
});
