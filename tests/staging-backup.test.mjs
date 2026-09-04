import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { decryptBackup } from "../scripts/backup-crypto.mjs";
import { createStagingBackup } from "../scripts/backup-staging.mjs";

test("staging backup encrypts the dump and copies it to the off-machine directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nexa-staging-backup-test-"));
  const local = path.join(root, "local"), offsite = path.join(root, "offsite"), restored = path.join(root, "restored.sql");
  const key = crypto.randomBytes(32), dump = "CREATE TABLE backup_test (id integer);\n".repeat(5);
  await import("node:fs/promises").then(({ mkdir }) => mkdir(offsite));
  try {
    const result = await createStagingBackup({
      databaseUrl: "postgresql://backup:secret@postgres:5432/exchange",
      outputDirectory: local,
      offsiteDirectory: offsite,
      encryptionKey: key.toString("base64"),
      dumpDatabase: async (_url, target) => writeFile(target, dump, { mode: 0o600 }),
    });
    assert.equal(path.basename(result.encrypted), path.basename(result.offsite));
    assert.deepEqual(await readFile(result.encrypted), await readFile(result.offsite));
    assert.equal((await readFile(result.encrypted)).includes(Buffer.from("CREATE TABLE")), false);
    await decryptBackup(result.offsite, restored, key);
    assert.equal(await readFile(restored, "utf8"), dump);
    assert.equal((await readdir(local)).some((name) => name.endsWith(".sql")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
