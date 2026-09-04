import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { backupKey, encryptBackup } from "./backup-crypto.mjs";

async function pgDump(databaseUrl, outputPath) {
  const url = new URL(databaseUrl);
  const output = await import("node:fs").then(({ createWriteStream }) => createWriteStream(outputPath, { flags: "wx", mode: 0o600 }));
  const child = spawn("pg_dump", ["--host", url.hostname, "--port", url.port || "5432", "--username", decodeURIComponent(url.username), "--dbname", url.pathname.slice(1), "--no-owner", "--no-privileges", "--format=plain"], {
    env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const outputCompleted = new Promise((resolve, reject) => {
    output.once("finish", resolve);
    output.once("error", reject);
  });
  child.stdout.pipe(output);
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  await outputCompleted;
  if (code !== 0) throw new Error(`pg_dump failed with exit code ${code}.`);
}

async function removeExpired(directory, retentionDays, now) {
  const cutoff = now.getTime() - retentionDays * 86_400_000;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/^exchange-staging-.*\.sql\.enc$/.test(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if ((await stat(target)).mtimeMs < cutoff) await rm(target);
  }
}

export async function createStagingBackup({
  databaseUrl,
  outputDirectory,
  offsiteDirectory,
  encryptionKey,
  retentionDays = 14,
  now = new Date(),
  dumpDatabase = pgDump,
} = {}) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required for staging backup.");
  if (!offsiteDirectory) throw new Error("OFFSITE_BACKUP_DIRECTORY is required for staging backup.");
  const days = Number(retentionDays);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("BACKUP_RETENTION_DAYS must be an integer from 1 to 365.");
  const key = backupKey(encryptionKey);
  const local = path.resolve(outputDirectory || path.join(process.cwd(), "backups"));
  const offsite = path.resolve(offsiteDirectory);
  await mkdir(local, { recursive: true, mode: 0o700 });
  if (!(await stat(offsite)).isDirectory()) throw new Error("OFFSITE_BACKUP_DIRECTORY must be an existing directory.");
  const temporary = await mkdtemp(path.join(os.tmpdir(), "nexa-staging-backup-"));
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const name = `exchange-staging-${stamp}-${crypto.randomBytes(3).toString("hex")}.sql.enc`;
  const plaintext = path.join(temporary, "database.sql");
  const encrypted = path.join(local, name);
  const remote = path.join(offsite, name);
  try {
    await dumpDatabase(databaseUrl, plaintext);
    if ((await stat(plaintext)).size < 100) throw new Error("Database backup was unexpectedly small.");
    await encryptBackup(plaintext, encrypted, key);
    await copyFile(encrypted, remote, constants.COPYFILE_EXCL);
    await chmod(remote, 0o600);
    if ((await stat(encrypted)).size !== (await stat(remote)).size) throw new Error("Offsite backup verification failed.");
    await Promise.all([removeExpired(local, days, now), removeExpired(offsite, days, now)]);
    return { encrypted, offsite: remote };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await createStagingBackup({
    databaseUrl: process.env.DATABASE_URL,
    outputDirectory: process.env.BACKUP_OUTPUT_DIRECTORY,
    offsiteDirectory: process.env.OFFSITE_BACKUP_DIRECTORY,
    encryptionKey: process.env.BACKUP_ENCRYPTION_KEY,
    retentionDays: process.env.BACKUP_RETENTION_DAYS,
  });
  console.log(`Encrypted staging backup copied off-machine: ${path.basename(result.offsite)}`);
}
