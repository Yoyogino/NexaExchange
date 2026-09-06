import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");

test("runtime image installs OS fixes and excludes unused package-manager tooling", () => {
  const runtime = dockerfile.slice(dockerfile.indexOf("FROM node:24-alpine AS runtime"));

  assert.match(runtime, /apk upgrade --no-cache/);
  assert.match(runtime, /npm ci --omit=dev/);
  assert.match(runtime, /rm -rf \/usr\/local\/lib\/node_modules\/npm/);
  assert.match(runtime, /USER node/);
});
