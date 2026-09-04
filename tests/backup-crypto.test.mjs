import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { decryptBackup, encryptBackup } from "../scripts/backup-crypto.mjs";

test("encrypted backups round-trip without plaintext in the encrypted file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nexa-backup-"));
  try {
    const input = path.join(root, "input.sql"), encrypted = path.join(root, "backup.enc"), restored = path.join(root, "restored.sql");
    const content = Buffer.from("CREATE TABLE demo (id integer);\n"), key = crypto.randomBytes(32);
    await writeFile(input, content); await encryptBackup(input, encrypted, key); await decryptBackup(encrypted, restored, key);
    assert.deepEqual(await readFile(restored), content); assert.equal((await readFile(encrypted)).includes(content), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("encrypted backups reject tampering", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nexa-backup-"));
  try {
    const input = path.join(root, "input.sql"), encrypted = path.join(root, "backup.enc"), restored = path.join(root, "restored.sql");
    const key = crypto.randomBytes(32); await writeFile(input, "backup"); await encryptBackup(input, encrypted, key);
    const payload = await readFile(encrypted); payload[20] ^= 1; await writeFile(encrypted, payload);
    await assert.rejects(() => decryptBackup(encrypted, restored, key));
  } finally { await rm(root, { recursive: true, force: true }); }
});
