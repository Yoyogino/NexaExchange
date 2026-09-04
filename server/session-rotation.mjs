/**
 * Session token rotation implementation.
 *
 * Security benefits:
 * - Limits window of exposure if token is leaked
 * - Reduces effectiveness of token theft attacks
 * - Each new request gets a fresh token (short lifetime)
 * - Old tokens remain valid during grace period to handle race conditions
 *
 * Implementation:
 * - Tokens rotated when session is touched (every 5 minutes by default)
 * - New token issued immediately, old token remains valid for 30 seconds
 * - Automatic cleanup of expired previous tokens
 */

import crypto from "node:crypto";

const TOKEN_GRACE_PERIOD_SECONDS = 30;

/**
 * Generate a new session token.
 * Returns a random UUID that's cryptographically suitable for session tokens.
 */
export function generateToken() {
  return crypto.randomUUID();
}

/**
 * Hash a session token for storage (one-way).
 */
export function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Prepare a session token rotation in the database.
 * Atomically:
 * 1. Generate new token
 * 2. Store old token hash as previous_token_hash
 * 3. Record rotation timestamp
 * 4. Returns the new token to send to client
 */
export async function rotateSessionToken(pool, sessionId) {
  const newToken = generateToken();
  const newTokenHash = tokenHash(newToken);

  const result = await pool.query(
    `UPDATE sessions 
     SET token_hash = $1, 
         rotated_at = now(),
         previous_token_hash = token_hash,
         previous_token_expires_at = now() + ($2 || ' seconds')::interval
     WHERE id = $3
     RETURNING user_id`,
    [newTokenHash, String(TOKEN_GRACE_PERIOD_SECONDS), sessionId],
  );

  if (!result.rows[0]) {
    throw new Error("Session not found for rotation");
  }

  return newToken;
}

/**
 * Authenticate a session token, accepting either current or recent previous token.
 * Returns session info if valid, or null if invalid.
 *
 * Accepts:
 * - Current token_hash
 * - Previous token_hash (if still within grace period)
 */
export async function authenticateSessionToken(pool, suppliedToken, sessionIdleMinutes = 30) {
  const currentHash = tokenHash(suppliedToken);

  const result = await pool.query(
    `SELECT 
       id, 
       user_id, 
       last_seen_at,
       token_hash = $1 AS is_current,
       previous_token_hash = $1 AND previous_token_expires_at > now() AS is_previous_valid
     FROM sessions 
     WHERE (token_hash = $1 OR (previous_token_hash = $1 AND previous_token_expires_at > now()))
       AND revoked_at IS NULL 
       AND expires_at > now() 
       AND last_seen_at > now() - ($2 || ' minutes')::interval
     LIMIT 1`,
    [currentHash, String(sessionIdleMinutes)],
  );

  if (!result.rows[0]) {
    return null; // Token invalid or session expired
  }

  const session = result.rows[0];
  return {
    sessionId: session.id,
    userId: session.user_id,
    lastSeenAt: session.last_seen_at,
    isCurrentToken: Boolean(session.is_current),
    isPreviousToken: Boolean(session.is_previous_valid),
  };
}

/**
 * Touch a session (update last_seen_at) and optionally rotate token.
 * Returns {sessionId, newToken} if rotated, or {sessionId, token: null} if not yet due.
 */
export async function touchSessionWithRotation(
  pool,
  sessionId,
  touchIntervalMinutes = 5,
  shouldRotate = true,
) {
  const exists = await pool.query("SELECT id FROM sessions WHERE id = $1", [sessionId]);
  if (!exists.rows[0]) throw new Error("Session not found");

  if (shouldRotate) {
    const newToken = generateToken();
    const rotated = await pool.query(
      `UPDATE sessions
       SET token_hash = $1,
           previous_token_hash = token_hash,
           previous_token_expires_at = now() + ($2 || ' seconds')::interval,
           rotated_at = now(),
           last_seen_at = now()
       WHERE id = $3
         AND last_seen_at <= now() - ($4 || ' minutes')::interval
         AND COALESCE(rotated_at, last_seen_at) <= now() - ($4 || ' minutes')::interval
       RETURNING id`,
      [tokenHash(newToken), String(TOKEN_GRACE_PERIOD_SECONDS), sessionId, String(touchIntervalMinutes)],
    );
    if (rotated.rows[0]) return { sessionId, newToken, rotated: true };
  }

  await pool.query(
    `UPDATE sessions SET last_seen_at = now()
     WHERE id = $1 AND last_seen_at <= now() - ($2 || ' minutes')::interval`,
    [sessionId, String(touchIntervalMinutes)],
  );
  return { sessionId, newToken: null, rotated: false };
}

/**
 * Clean up expired previous tokens (older than grace period).
 * Call this periodically to maintain database cleanliness.
 */
export async function cleanupExpiredTokens(pool) {
  const result = await pool.query(
    `UPDATE sessions 
     SET previous_token_hash = NULL, previous_token_expires_at = NULL
     WHERE previous_token_expires_at IS NOT NULL 
       AND previous_token_expires_at < now()`,
  );

  return result.rowCount;
}

/**
 * Get rotation statistics for monitoring.
 */
export async function getRotationStats(pool) {
  const result = await pool.query(
    `SELECT 
       COUNT(*) as total_sessions,
       COUNT(*) FILTER (WHERE previous_token_hash IS NOT NULL AND previous_token_expires_at > now()) as sessions_in_grace_period,
       COUNT(*) FILTER (WHERE rotated_at > now() - interval '1 hour') as rotated_last_hour
     FROM sessions 
     WHERE revoked_at IS NULL AND expires_at > now()`,
  );

  const row = result.rows[0];
  return {
    total_sessions: Number.parseInt(row.total_sessions, 10),
    sessions_in_grace_period: Number.parseInt(row.sessions_in_grace_period, 10),
    rotated_last_hour: Number.parseInt(row.rotated_last_hour, 10),
  };
}
