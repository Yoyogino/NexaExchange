import crypto from "node:crypto";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const PREFIX = "enc:v1";

export async function loadEncryptionKey() {
  if (process.env.DATA_ENCRYPTION_KEY) {
    const key = Buffer.from(process.env.DATA_ENCRYPTION_KEY, "base64");
    if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
    return key;
  }
  if (process.env.NODE_ENV === "production") throw new Error("DATA_ENCRYPTION_KEY is required in production.");
  const keyPath = resolve(".local-secrets", "data-encryption.key");
  try {
    const key = Buffer.from((await readFile(keyPath, "utf8")).trim(), "base64");
    if (key.length !== 32) throw new Error("Local data-encryption key is invalid.");
    return key;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const key = crypto.randomBytes(32);
    await mkdir(dirname(keyPath), { recursive: true });
    await writeFile(keyPath, key.toString("base64"), { encoding: "utf8", flag: "wx" });
    await chmod(keyPath, 0o600).catch(() => {});
    return key;
  }
}

export function encryptSecret(plaintext, key) {
  if (!plaintext || String(plaintext).startsWith(`${PREFIX}:`)) return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return `${PREFIX}:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptSecret(value, key) {
  if (!value || !String(value).startsWith(`${PREFIX}:`)) return value;
  const [, , iv, tag, encrypted] = String(value).split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

export async function migrateAuthenticatorSecrets(pool, key) {
  const result = await pool.query("SELECT id,two_factor_secret FROM users WHERE two_factor_secret IS NOT NULL AND two_factor_secret NOT LIKE 'enc:v1:%'");
  for (const user of result.rows) await pool.query("UPDATE users SET two_factor_secret=$1 WHERE id=$2", [encryptSecret(user.two_factor_secret, key), user.id]);
  return result.rowCount;
}
