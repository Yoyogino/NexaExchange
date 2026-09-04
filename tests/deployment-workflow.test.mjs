import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../.github/workflows/deploy-staging.yml", import.meta.url), "utf8");

test("staging deployment is manual, verified, serialized, and environment-protected", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s+push:/);
  assert.match(workflow, /deploy:\n\s+needs: verify/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /STAGING_SSH_KNOWN_HOSTS/);
  assert.match(workflow, /api\/ready/);
});
