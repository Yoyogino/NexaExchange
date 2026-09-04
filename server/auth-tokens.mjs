import crypto from "node:crypto";
import { recordAudit } from "./ledger.mjs";

async function replaceToken(client, table, { userId, codeHash }) {
  const id = crypto.randomUUID();
  await client.query(
    `INSERT INTO ${table} (id,user_id,code_hash,expires_at)
     VALUES ($1,$2,$3,now() + interval '15 minutes')
     ON CONFLICT (user_id) DO UPDATE
     SET id=EXCLUDED.id, code_hash=EXCLUDED.code_hash, expires_at=EXCLUDED.expires_at, created_at=now()`,
    [id, userId, codeHash],
  );
  return id;
}

export const replaceEmailVerificationToken = (client, values) => replaceToken(client, "email_verification_tokens", values);
export const replacePasswordResetToken = (client, values) => replaceToken(client, "password_reset_tokens", values);

export async function issueEmailVerificationToken(client, values) {
  const id = await replaceEmailVerificationToken(client, values);
  await recordAudit(client, { actorUserId: values.userId, action: "email.verification_requested", targetType: "user", targetId: values.userId });
  return id;
}

export async function issuePasswordResetToken(client, values) {
  const id = await replacePasswordResetToken(client, values);
  await recordAudit(client, { actorUserId: values.userId, action: "password.reset_requested", targetType: "user", targetId: values.userId });
  return id;
}

export async function consumeEmailVerificationToken(client, { userId, codeHash }) {
  const result = await client.query(
    "DELETE FROM email_verification_tokens WHERE user_id=$1 AND code_hash=$2 AND expires_at>now() RETURNING id",
    [userId, codeHash],
  );
  return Boolean(result.rows[0]);
}

export async function consumeRecoveryCode(client, { userId, codeHash }) {
  const result = await client.query(
    "UPDATE recovery_codes SET used_at=now() WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING id",
    [userId, codeHash],
  );
  return Boolean(result.rows[0]);
}
