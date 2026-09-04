import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import pg from "pg";
import { consumeEmailVerificationToken, consumeRecoveryCode, issueEmailVerificationToken, issuePasswordResetToken, replaceEmailVerificationToken, replacePasswordResetToken } from "../server/auth-tokens.mjs";
import { ensureLedgerSchema } from "../server/ledger.mjs";
import { assertIsolatedTestDatabase } from "./helpers/test-database.mjs";
import { consumeTotp } from "../server/totp.mjs";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let userId;

test.before(async () => {
  await assertIsolatedTestDatabase(pool);
  await ensureLedgerSchema(pool);
  await pool.query("CREATE TABLE email_verification_tokens (id UUID PRIMARY KEY,user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,code_hash TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now()); CREATE TABLE password_reset_tokens (id UUID PRIMARY KEY,user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,code_hash TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now()); CREATE TABLE recovery_codes (id UUID PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,code_hash TEXT NOT NULL,used_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now());");
  userId = crypto.randomUUID();
  await pool.query("INSERT INTO users (id,email,password_hash) VALUES ($1,$2,'unused')", [userId, `${userId}@example.test`]);
});

test.after(async () => pool.end());

test("concurrent code requests atomically leave one current token", async () => {
  await Promise.all([
    replaceEmailVerificationToken(pool, { userId, codeHash: "hmac$first" }),
    replaceEmailVerificationToken(pool, { userId, codeHash: "hmac$second" }),
  ]);
  await Promise.all([
    replacePasswordResetToken(pool, { userId, codeHash: "hmac$first" }),
    replacePasswordResetToken(pool, { userId, codeHash: "hmac$second" }),
  ]);
  for (const table of ["email_verification_tokens", "password_reset_tokens"]) {
    const result = await pool.query(`SELECT code_hash FROM ${table} WHERE user_id=$1`, [userId]);
    assert.equal(result.rows.length, 1);
    assert.ok(["hmac$first", "hmac$second"].includes(result.rows[0].code_hash));
  }
});

test("a verification token can be consumed exactly once under concurrency", async () => {
  await replaceEmailVerificationToken(pool, { userId, codeHash: "hmac$consume" });
  const results = await Promise.all([
    consumeEmailVerificationToken(pool, { userId, codeHash: "hmac$consume" }),
    consumeEmailVerificationToken(pool, { userId, codeHash: "hmac$consume" }),
  ]);
  assert.deepEqual(results.sort(), [false, true]);
});

test("recovery-code consumption rolls back when login does not commit", async () => {
  const codeHash = "hmac$recovery";
  await pool.query("INSERT INTO recovery_codes (id,user_id,code_hash) VALUES ($1,$2,$3)", [crypto.randomUUID(), userId, codeHash]);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    assert.equal(await consumeRecoveryCode(client, { userId, codeHash }), true);
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
  assert.equal(await consumeRecoveryCode(pool, { userId, codeHash }), true);
  assert.equal(await consumeRecoveryCode(pool, { userId, codeHash }), false);
});

test("an authenticator time-step can be consumed only once under concurrency", async () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const results = await Promise.all([
    consumeTotp(pool, { userId, secret, code: "287082", now: 59_000 }),
    consumeTotp(pool, { userId, secret, code: "287082", now: 59_000 }),
  ]);
  assert.deepEqual(results.sort(), [false, true]);
});

test("token issuance and its audit event commit or roll back together", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await issueEmailVerificationToken(client, { userId, codeHash: "hmac$rolled-back" });
    await client.query("ROLLBACK");
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM email_verification_tokens WHERE code_hash='hmac$rolled-back'")).rows[0].count, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE action='email.verification_requested'")).rows[0].count, 0);

    await client.query("BEGIN");
    await issuePasswordResetToken(client, { userId, codeHash: "hmac$committed" });
    await client.query("COMMIT");
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM password_reset_tokens WHERE code_hash='hmac$committed'")).rows[0].count, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE action='password.reset_requested'")).rows[0].count, 1);
  } finally {
    client.release();
  }
});
