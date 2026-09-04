import crypto from "node:crypto";

export function createCodeHasher(secretKey) {
  if (!Buffer.isBuffer(secretKey) || secretKey.length !== 32) throw new Error("Code hashing requires a 32-byte secret key.");
  return (code) => `hmac$${crypto.createHmac("sha256", secretKey).update(String(code)).digest("hex")}`;
}
