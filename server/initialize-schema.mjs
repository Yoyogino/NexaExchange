import { ensureLedgerSchema } from "./ledger.mjs";
import { ensureMarketSchema } from "./matching.mjs";
import { migrateSessionRotation } from "./migrations/001-session-rotation.mjs";
import { migrateAuthenticatorSecrets } from "./secret-encryption.mjs";

export async function ensureAuthenticationIndexes(pool) {
  await pool.query(`
    CREATE INDEX IF NOT EXISTS sessions_user_active_idx
      ON sessions (user_id, created_at DESC) WHERE revoked_at IS NULL;
    CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);
    CREATE INDEX IF NOT EXISTS sessions_revoked_idx
      ON sessions (revoked_at) WHERE revoked_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS recovery_codes_active_lookup_idx
      ON recovery_codes (user_id, code_hash) WHERE used_at IS NULL;
    CREATE INDEX IF NOT EXISTS login_history_user_created_idx
      ON login_history (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS email_verification_tokens_expires_idx
      ON email_verification_tokens (expires_at);
    CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_idx
      ON password_reset_tokens (expires_at);
  `);
}

export async function initializeApplicationSchema(pool, encryptionKey) {
  await ensureLedgerSchema(pool);
  const migratedAuthenticatorSecrets = await migrateAuthenticatorSecrets(pool, encryptionKey);
  if (migratedAuthenticatorSecrets) console.info(JSON.stringify({ event: "authenticator_secrets_encrypted", count: migratedAuthenticatorSecrets }));
  await ensureMarketSchema(pool);
  await pool.query("CREATE TABLE IF NOT EXISTS sessions (id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT UNIQUE NOT NULL, expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()); CREATE INDEX IF NOT EXISTS sessions_active_idx ON sessions (token_hash, expires_at) WHERE revoked_at IS NULL;");
  await pool.query("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip_address TEXT; ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent TEXT; ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(); CREATE TABLE IF NOT EXISTS recovery_codes (id UUID PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,code_hash TEXT NOT NULL,used_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now()); CREATE TABLE IF NOT EXISTS login_history (id UUID PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,succeeded BOOLEAN NOT NULL,ip_address TEXT,user_agent TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now());");
  await migrateSessionRotation(pool);
  await pool.query("CREATE TABLE IF NOT EXISTS email_verification_tokens (id UUID PRIMARY KEY,user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,code_hash TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now()); CREATE TABLE IF NOT EXISTS password_reset_tokens (id UUID PRIMARY KEY,user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,code_hash TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());");
  await ensureAuthenticationIndexes(pool);
  // Legacy SHA-256 hashes of low-entropy codes can be brute-forced from a
  // stolen database. They cannot be upgraded without the original codes.
  await pool.query("DELETE FROM email_verification_tokens WHERE code_hash NOT LIKE 'hmac$%'; DELETE FROM password_reset_tokens WHERE code_hash NOT LIKE 'hmac$%'; DELETE FROM recovery_codes WHERE code_hash NOT LIKE 'hmac$%';");
}
