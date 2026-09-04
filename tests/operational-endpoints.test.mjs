import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const index = await readFile(new URL("../server/index.mjs", import.meta.url), "utf8");
const admin = await readFile(new URL("../server/admin.mjs", import.meta.url), "utf8");

test("session statistics are available only through the role-protected admin router", () => {
  assert.doesNotMatch(index, /app\.get\("\/api\/health\/sessions"/);
  assert.match(index, /app\.use\("\/api\/admin", requireSession/);
  assert.match(admin, /router\.use[\s\S]*role !== "ADMIN"/);
  assert.match(admin, /router\.get\("\/session-health"/);
});
