import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("staging backup is isolated, encrypted, off-machine, and scheduled persistently", async () => {
  const [compose, dockerfile, service, timer] = await Promise.all([
    readFile(new URL("../compose.staging.yml", import.meta.url), "utf8"),
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../deploy/systemd/nexa-exchange-backup.service", import.meta.url), "utf8"),
    readFile(new URL("../deploy/systemd/nexa-exchange-backup.timer", import.meta.url), "utf8"),
  ]);
  assert.match(compose, /profiles: \["operations"\]/);
  assert.match(compose, /BACKUP_ENCRYPTION_KEY/);
  assert.match(compose, /OFFSITE_BACKUP_DIRECTORY/);
  assert.match(dockerfile, /postgresql-client/);
  assert.match(service, /--profile operations run --rm backup/);
  assert.match(timer, /OnCalendar=daily/);
  assert.match(timer, /RandomizedDelaySec=1h/);
  assert.match(timer, /Persistent=true/);
});
