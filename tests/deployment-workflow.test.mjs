import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { execFileSync } from "node:child_process";

const workflow = await readFile(new URL("../.github/workflows/deploy-staging.yml", import.meta.url), "utf8");

test("rollback restores the previous image under the name used by Compose", () => {
  const captureStart = workflow.indexOf('          previous_app_image=""');
  const captureEnd = workflow.indexOf("          docker compose", captureStart);
  assert.ok(captureStart >= 0 && captureEnd > captureStart);
  const capture = workflow.slice(captureStart, captureEnd);
  const retag = workflow.split(/\r?\n/).find((line) => line.trim().startsWith('docker tag "$previous_app_image"'));
  assert.ok(retag);
  const script = `set -eu
docker() {
  if [ "$1" = inspect ]; then
    case "$*" in
      *'.Config.Image'*) printf '%s\\n' 'ubuntu-app' ;;
      *'com.docker.compose.image'*) printf '%s\\n' 'sha256:old-image' ;;
      *'.Image'*) printf '%s\\n' 'sha256:old-image' ;;
    esac
  elif [ "$1" = tag ]; then
    test "$2" = 'sha256:old-image'
    test "$3" = 'ubuntu-app'
    printf '%s\\n' 'previous-image-restored'
  elif [ "$1" = image ] && [ "$2" = inspect ]; then
    test "\${MOCK_IMAGE_MISSING:-0}" = 0
  else
    return 1
  fi
}
restore_legacy_containers() { :; }
${capture}
${retag}
`;
  const shell = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
  assert.equal(execFileSync(shell, ["--noprofile", "--norc"], { input: script, encoding: "utf8" }).trim(), "previous-image-restored");
  assert.throws(
    () => execFileSync(shell, ["--noprofile", "--norc"], {
      input: script, encoding: "utf8", env: { ...process.env, MOCK_IMAGE_MISSING: "1" },
    }),
    (error) => error.status === 1
      && error.stdout.includes("refusing deployment without a rollback image")
      && !error.stdout.includes("previous-image-restored"),
  );
});

test("staging deployment is manual, verified, serialized, and environment-protected", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s+push:/);
  assert.match(workflow, /deploy:\r?\n\s+needs: verify/);
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
