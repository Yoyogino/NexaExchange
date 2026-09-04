import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);

export async function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password, storedHash) {
  const [salt, expectedHex, extra] = String(storedHash ?? "").split(":");
  if (!salt || !expectedHex || extra || !/^[a-f0-9]{128}$/i.test(expectedHex)) return false;
  const actual = await scrypt(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// Used only to equalize the cost of login attempts for unknown accounts.
// It is not attached to a user and can never authenticate successfully.
const DUMMY_PASSWORD_HASH = await hashPassword(
  "not-a-real-account-password",
  "00000000000000000000000000000000",
);

export async function verifyLoginPassword(password, storedHash) {
  const valid = await verifyPassword(password, storedHash ?? DUMMY_PASSWORD_HASH);
  return Boolean(storedHash) && valid;
}
