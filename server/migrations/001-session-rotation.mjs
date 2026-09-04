/**
 * Database migration to add session token rotation support.
 * Adds columns to existing sessions table for storing previous tokens.
 */

export async function migrateSessionRotation(pool) {
  await pool.query(`
    -- Add token rotation columns if they don't exist
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS previous_token_hash TEXT;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS previous_token_expires_at TIMESTAMPTZ;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ;

    -- Add index for efficient grace period queries
    CREATE INDEX IF NOT EXISTS sessions_grace_period_idx 
      ON sessions (previous_token_hash, previous_token_expires_at) 
      WHERE previous_token_hash IS NOT NULL;

    -- Add index for rotation timestamp queries
    CREATE INDEX IF NOT EXISTS sessions_rotation_idx 
      ON sessions (rotated_at) 
      WHERE rotated_at IS NOT NULL;
  `);
}
