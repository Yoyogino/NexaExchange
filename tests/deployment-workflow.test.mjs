import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("complete deployment shell preserves migration ordering and verifies recovery outcomes", async () => {
  const marker = "      - name: Deploy and verify readiness";
  const start = workflow.indexOf("          set -eu", workflow.indexOf(marker));
  const end = workflow.indexOf("      - name:", start);
  assert.ok(start >= 0 && end > start);
  const deployment = workflow.slice(start, end).replace(/^          /gm, "");
  const shell = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
  const directory = await mkdtemp(join(tmpdir(), "nexa-deployment-test-"));
  try {
    for (const scenario of ["migration-failure", "recovered", "recovery-failure", "healthy"]) {
      const result = spawnSync(shell, ["--noprofile", "--norc"], {
        cwd: directory, encoding: "utf8", timeout: 10000,
        input: `
id() { echo docker; }
node() { echo role-sync; }
sleep() { :; }
docker() {
  case "$*" in
    'inspect --format '*'.Mounts'*) echo ubuntu_staging_postgres ;;
    'inspect --format '*'com.docker.compose.project'*) echo ubuntu ;;
    'inspect --format '*'.Config.Image'*) echo ubuntu-app ;;
    'inspect --format '*'.Image'*) echo sha256:previous ;;
    'inspect --format '*'.State.Health.Status'*) echo healthy ;;
    'inspect ubuntu-'*) return 0 ;;
    'image inspect sha256:previous') return 0 ;;
    'tag sha256:previous ubuntu-app') echo retagged ;;
    'restart ubuntu-proxy-1') echo proxy-restarted ;;
    'compose '*' build app migrate') echo built ;;
    'compose '*' up -d --no-deps postgres redis') echo dependencies-preserved ;;
    'compose '*' run --rm migrate')
      echo migration-attempted
      test '${scenario}' != migration-failure ;;
    'compose '*' up -d --no-deps app') echo replacement-started ;;
    'compose '*' up -d --no-deps --force-recreate app') echo previous-app-recreated ;;
    'compose '*' exec -T app wget '*) test '${scenario}' = healthy ;;
    'compose '*' logs --tail '*) echo diagnostic-logs ;;
    'exec ubuntu-app-1 wget '*) test '${scenario}' = recovered ;;
    'compose '*' up -d --no-deps proxy') echo proxy-started ;;
    'compose '*' ps') echo final-status ;;
    *) echo "Unexpected Docker operation: $*" >&2; exit 90 ;;
  esac
}
${deployment}`,
      });
      assert.ifError(result.error);
      assert.equal(result.stderr, "", scenario);
      assert.equal(result.status, scenario === "healthy" ? 0 : 1, scenario);
      assert.match(result.stdout, /dependencies-preserved\nrole-sync\nmigration-attempted/);
      if (scenario === "migration-failure") {
        assert.doesNotMatch(result.stdout, /replacement-started|retagged|previous-app-recreated/);
      } else if (scenario === "healthy") {
        assert.match(result.stdout, /replacement-started\nproxy-started\nfinal-status/);
        assert.doesNotMatch(result.stdout, /retagged|recovery/);
      } else {
        assert.match(result.stdout, /replacement-started\ndiagnostic-logs\nretagged\nprevious-app-recreated/);
        assert.match(result.stdout, scenario === "recovered"
          ? /Application recovery readiness confirmed; deployment remains failed/
          : /::error::Application recovery did not become ready/);
        assert.doesNotMatch(result.stdout, /final-status/);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
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
