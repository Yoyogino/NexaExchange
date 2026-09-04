import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboard = await readFile(new URL("../src/Dashboard.tsx", import.meta.url), "utf8");
const admin = await readFile(new URL("../src/AdminPanel.tsx", import.meta.url), "utf8");
const auth = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");

test("data tables have accessible names", () => {
  for (const source of [dashboard, admin]) {
    const tableCount = (source.match(/<table\b/g) ?? []).length;
    const captionCount = (source.match(/<caption\b/g) ?? []).length;
    assert.equal(captionCount, tableCount);
  }
});

test("temporary authentication codes expose mobile and password-manager hints", () => {
  const resetInput = auth.match(/Reset code(<input[\s\S]*?\/>)/)?.[1] ?? "";
  const secondFactorInput = auth.match(/Authenticator or recovery code(<input[\s\S]*?\/>)/)?.[1] ?? "";
  const verificationInput = dashboard.match(/(<input aria-label="Verification code"[\s\S]*?\/>)/)?.[1] ?? "";
  assert.match(resetInput, /inputMode="numeric"/);
  assert.match(resetInput, /autoComplete="one-time-code"/);
  assert.match(secondFactorInput, /autoComplete="one-time-code"/);
  assert.match(verificationInput, /autoComplete="one-time-code"/);
});

test("admin order filters expose their selected state and adjustment errors are announced", () => {
  assert.match(admin, /aria-label="Filter orders by status"/);
  assert.match(admin, /aria-pressed=\{orderStatusFilter === status\}/);
  assert.match(admin, /adjustError && <p className="error" role="alert">/);
});

test("React views contain no inline styles blocked by the production CSP", () => {
  for (const source of [dashboard, admin, auth]) assert.doesNotMatch(source, /\bstyle=\{/);
});
