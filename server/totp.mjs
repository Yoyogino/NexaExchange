import crypto from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function createSecret() {
  const bytes = crypto.randomBytes(20); let bits = ""; let output = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  for (let i = 0; i < bits.length; i += 5) output += ALPHABET[Number.parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return output;
}

function decodeBase32(value) {
  let bits = "";
  for (const char of value.replace(/=+$/, "").toUpperCase()) bits += ALPHABET.indexOf(char).toString(2).padStart(5, "0");
  const bytes = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function codeAt(secret, counter) {
  const buffer = Buffer.alloc(8); buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", decodeBase32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 15;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, "0");
}

export function matchTotpCounter(secret, code, now = Date.now()) {
  if (!/^\d{6}$/.test(String(code))) return null;
  const counter = Math.floor(now / 30_000);
  for (const offset of [-1, 0, 1]) {
    const candidate = counter + offset;
    const expected = Buffer.from(codeAt(secret, candidate));
    const supplied = Buffer.from(String(code));
    if (crypto.timingSafeEqual(expected, supplied)) return candidate;
  }
  return null;
}

export function verifyTotp(secret, code, now = Date.now()) {
  return matchTotpCounter(secret, code, now) !== null;
}

export async function consumeTotp(client, { userId, secret, code, now = Date.now() }) {
  const counter = matchTotpCounter(secret, code, now);
  if (counter === null) return false;
  const result = await client.query(
    `UPDATE users SET two_factor_last_counter=$2
     WHERE id=$1 AND (two_factor_last_counter IS NULL OR two_factor_last_counter < $2)
     RETURNING id`,
    [userId, String(counter)],
  );
  return Boolean(result.rows[0]);
}

export function provisioningUri(email, secret) {
  return `otpauth://totp/${encodeURIComponent(`Nexa Exchange:${email}`)}?secret=${secret}&issuer=${encodeURIComponent("Nexa Exchange")}&digits=6&period=30`;
}
