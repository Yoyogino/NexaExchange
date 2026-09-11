import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";

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
      *'ImageManifestDescriptor.Platform'*) printf '%s\\n' 'linux/amd64' ;;
      *'ImageManifestDescriptor.Digest'*) printf '%s\\n' 'sha256:running-manifest' ;;
      *'.Config.Image'*) printf '%s\\n' 'ubuntu-app' ;;
      *'com.docker.compose.image'*) printf '%s\\n' 'sha256:old-image' ;;
      *'.Image'*) printf '%s\\n' 'sha256:old-image' ;;
    esac
  elif [ "$1" = tag ]; then
    if [ "\${MOCK_IMAGE_MISSING:-0}" = 0 ]; then
      test "$2" = 'sha256:old-image'
    else
      test "$2" = 'sha256:verified-index'
    fi
    test "$3" = 'ubuntu-app'
    printf '%s\\n' 'previous-image-restored'
  elif [ "$1" = image ] && [ "$2" = inspect ]; then
    case "$*" in
      *'--platform'*)
        if [ "\${MOCK_MANIFEST_MATCH:-0}" = 1 ]; then
          printf '%s\\n' 'sha256:running-manifest'
        else
          printf '%s\\n' 'sha256:other-manifest'
        fi ;;
      *'ubuntu-app'*) printf '%s\\n' 'sha256:verified-index' ;;
      *) test "\${MOCK_IMAGE_MISSING:-0}" = 0 ;;
    esac
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
  assert.equal(execFileSync(shell, ["--noprofile", "--norc"], {
    input: script, encoding: "utf8",
    env: { ...process.env, MOCK_IMAGE_MISSING: "1", MOCK_MANIFEST_MATCH: "1" },
  }).trim(), "previous-image-restored");
  assert.throws(
    () => execFileSync(shell, ["--noprofile", "--norc"], {
      input: script, encoding: "utf8", env: { ...process.env, MOCK_IMAGE_MISSING: "1" },
    }),
    (error) => error.status === 1
      && error.stdout.includes("refusing deployment without a rollback image")
      && !error.stdout.includes("previous-image-restored"),
  );
});

test("rollback verifies delayed readiness and reports persistent recovery failure", () => {
  const start = workflow.indexOf('              if [ -n "$previous_app_image"');
  const end = workflow.indexOf("            fi", workflow.indexOf('echo "Application recovery readiness confirmed;', start));
  assert.ok(start >= 0 && end > start);
  const recovery = workflow.slice(start, end);
  const shell = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
  for (const readyAfter of [3, 99]) {
    const result = spawnSync(shell, ["--noprofile", "--norc"], {
      encoding: "utf8",
      input: `set -eu
previous_app_image=old
previous_app_tag=app
attempts=0
docker() {
  case "$1" in
    tag) echo retagged ;;
    compose) echo recreated ;;
    exec) attempts=$((attempts + 1)); echo "probe-$attempts"; test "$attempts" -ge ${readyAfter} ;;
    *) return 2 ;;
  esac
}
restore_legacy_containers() { echo legacy-restored; }
sleep() { :; }
${recovery}`,
    });
    assert.equal(result.status, 1, "deployment must remain failed even after recovery");
    assert.match(result.stdout, /retagged\nrecreated\nlegacy-restored\nprobe-1/);
    if (readyAfter === 3) {
      assert.match(result.stdout, /probe-3\nApplication recovery readiness confirmed/);
      assert.doesNotMatch(result.stdout, /operator intervention|probe-4/);
    } else {
      assert.match(result.stdout, /probe-30\n::error::Application recovery did not become ready/);
      assert.doesNotMatch(result.stdout, /readiness confirmed|probe-31/);
    }
  }
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
