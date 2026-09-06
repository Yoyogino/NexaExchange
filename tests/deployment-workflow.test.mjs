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
  assert.match(workflow, /cp \.env\.example \.env/);
  assert.match(workflow, /runs-on: \[self-hosted, Linux, X64\]/);
  assert.doesNotMatch(workflow, /STAGING_SSH_PRIVATE_KEY|STAGING_SSH_KNOWN_HOSTS/);
  assert.match(workflow, /\/home\/ubuntu\/\.env\.staging/);
  assert.match(workflow, /id -nG \| grep -qw docker/);
  assert.match(workflow, /POSTGRES_VOLUME_NAME/);
  assert.match(workflow, /\/var\/lib\/postgresql\/data/);
  assert.match(workflow, /for service in app postgres redis proxy/);
  assert.match(workflow, /sync-staging-db-role-passwords\.mjs/);
  assert.match(workflow, /run --rm migrate/);
  assert.match(workflow, /up -d --no-deps postgres redis/);
  assert.match(workflow, /up -d --no-deps app/);
  assert.match(workflow, /up -d --no-deps proxy/);
  assert.doesNotMatch(workflow, /compose[^\n]* down/);
  assert.match(workflow, /api\/ready/);
});
