import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import pg from "pg";
import { ensureAuthenticationIndexes } from "../server/initialize-schema.mjs";
import { assertIsolatedTestDatabase } from "./helpers/test-database.mjs";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await assertIsolatedTestDatabase(pool);

test("authentication queries and retention cleanup have matching indexes", async () => {
  const schema = `auth_indexes_${crypto.randomUUID().replaceAll("-", "")}`;
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE sessions (user_id UUID, created_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, expires_at TIMESTAMPTZ);
      CREATE TABLE recovery_codes (user_id UUID, code_hash TEXT, used_at TIMESTAMPTZ);
      CREATE TABLE login_history (user_id UUID, created_at TIMESTAMPTZ);
      CREATE TABLE email_verification_tokens (expires_at TIMESTAMPTZ);
      CREATE TABLE password_reset_tokens (expires_at TIMESTAMPTZ);
    `);
    await ensureAuthenticationIndexes(client);
    const expected = [
      "email_verification_tokens_expires_idx",
      "login_history_user_created_idx",
      "password_reset_tokens_expires_idx",
      "recovery_codes_active_lookup_idx",
      "sessions_expires_idx",
      "sessions_revoked_idx",
      "sessions_user_active_idx",
    ];
    const result = await client.query(
      "SELECT indexname FROM pg_indexes WHERE schemaname=$1 AND indexname=ANY($2::text[]) ORDER BY indexname",
      [schema, expected],
    );
    assert.deepEqual(result.rows.map((row) => row.indexname), expected);
  } finally {
    await client.query("RESET search_path");
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
  }
});

test.after(async () => pool.end());
