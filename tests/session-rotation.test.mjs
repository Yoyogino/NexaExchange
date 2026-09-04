import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import crypto from "node:crypto";
import {
  generateToken,
  tokenHash,
  rotateSessionToken,
  authenticateSessionToken,
  touchSessionWithRotation,
  cleanupExpiredTokens,
  getRotationStats,
} from "../server/session-rotation.mjs";
import { assertIsolatedTestDatabase } from "./helpers/test-database.mjs";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

test.before(async () => {
  await assertIsolatedTestDatabase(pool);
  // Set up schema
  await pool.query(`
    DROP TABLE IF EXISTS sessions CASCADE;
    CREATE TABLE sessions (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      previous_token_hash TEXT,
      previous_token_expires_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      rotated_at TIMESTAMPTZ,
      ip_address TEXT,
      user_agent TEXT
    );
    CREATE INDEX sessions_active_idx ON sessions (token_hash, expires_at) WHERE revoked_at IS NULL;
  `);
});

test.after(async () => {
  await pool.end();
});

test.beforeEach(async () => {
  await pool.query("TRUNCATE sessions");
});

async function createTestSession(userId, expiresInHours = 12) {
  const sessionId = crypto.randomUUID();
  const token = generateToken();
  const tokenHashValue = tokenHash(token);

  await pool.query(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' hours')::interval)`,
    [sessionId, userId, tokenHashValue, String(expiresInHours)],
  );

  return { sessionId, token };
}

test("generateToken produces valid UUIDs", () => {
  const token = generateToken();
  assert.ok(token.match(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i), "Should be a valid UUID v4");
});

test("tokenHash produces consistent hashes", () => {
  const token = "test-token-123";
  const hash1 = tokenHash(token);
  const hash2 = tokenHash(token);
  assert.equal(hash1, hash2, "Same token should produce same hash");
  assert.ok(hash1.match(/^[0-9a-f]{64}$/), "Should be a valid SHA256 hex");
});

test("authenticateSessionToken validates current token", async () => {
  const userId = crypto.randomUUID();
  const { sessionId, token } = await createTestSession(userId);

  const session = await authenticateSessionToken(pool, token);
  assert.equal(session.sessionId, sessionId);
  assert.equal(session.userId, userId);
  assert.equal(session.isCurrentToken, true);
  assert.equal(session.isPreviousToken, false);
});

test("authenticateSessionToken rejects invalid token", async () => {
  const session = await authenticateSessionToken(pool, "invalid-token");
  assert.equal(session, null);
});

test("rotateSessionToken creates new token and stores previous", async () => {
  const userId = crypto.randomUUID();
  const { sessionId, token: oldToken } = await createTestSession(userId);

  const newToken = await rotateSessionToken(pool, sessionId);
  assert.notEqual(newToken, oldToken, "New token should be different");

  // Old token should no longer authenticate as current
  let session = await authenticateSessionToken(pool, oldToken);
  assert.ok(session, "Old token should still be valid during grace period");
  assert.equal(session.isPreviousToken, true, "Old token should be marked as previous");

  // New token should authenticate as current
  session = await authenticateSessionToken(pool, newToken);
  assert.ok(session, "New token should be valid");
  assert.equal(session.isCurrentToken, true, "New token should be marked as current");
});

test("rotateSessionToken expires previous token after grace period", async () => {
  const userId = crypto.randomUUID();
  const { sessionId, token: oldToken } = await createTestSession(userId);

  const newToken = await rotateSessionToken(pool, sessionId);

  // Immediately, old token works
  let session = await authenticateSessionToken(pool, oldToken);
  assert.ok(session, "Old token valid during grace period");

  // After grace period, old token is invalid
  await pool.query("UPDATE sessions SET previous_token_expires_at = previous_token_expires_at - interval '60 seconds' WHERE id = $1", [sessionId]);

  session = await authenticateSessionToken(pool, oldToken);
  assert.equal(session, null, "Old token should expire after grace period");

  // But new token still works
  session = await authenticateSessionToken(pool, newToken);
  assert.ok(session, "New token should still be valid");
});

test("touchSessionWithRotation updates last_seen_at when due", async () => {
  const userId = crypto.randomUUID();
  const { sessionId, token } = await createTestSession(userId);

  // Set last_seen_at to 6 minutes ago (rotation due every 5 min)
  await pool.query(
    "UPDATE sessions SET last_seen_at = now() - interval '6 minutes' WHERE id = $1",
    [sessionId],
  );

  const result = await touchSessionWithRotation(pool, sessionId, 5, false); // Don't rotate yet
  assert.equal(result.newToken, null, "Should not rotate if rotation disabled");
  assert.equal(result.rotated, false);

  // Verify last_seen_at was updated
  const updated = await pool.query("SELECT last_seen_at FROM sessions WHERE id = $1", [sessionId]);
  const timeSinceTouch = Date.now() - new Date(updated.rows[0].last_seen_at).getTime();
  assert.ok(timeSinceTouch < 1000, "last_seen_at should be very recent");
});

test("touchSessionWithRotation rotates token when due", async () => {
  const userId = crypto.randomUUID();
  const { sessionId, token: oldToken } = await createTestSession(userId);

  // Set last_seen_at and rotated_at to 6 minutes ago
  await pool.query(
    `UPDATE sessions 
     SET last_seen_at = now() - interval '6 minutes',
         rotated_at = now() - interval '6 minutes'
     WHERE id = $1`,
    [sessionId],
  );

  const result = await touchSessionWithRotation(pool, sessionId, 5, true);
  assert.ok(result.newToken, "Should return new token");
  assert.equal(result.rotated, true);
  assert.notEqual(result.newToken, oldToken);

  // Old token should be in grace period
  const session = await authenticateSessionToken(pool, oldToken);
  assert.ok(session, "Old token should be valid during grace period");
});

test("touchSessionWithRotation returns null token if not yet due", async () => {
  const userId = crypto.randomUUID();
  const { sessionId } = await createTestSession(userId);

  const result = await touchSessionWithRotation(pool, sessionId, 5, true);
  assert.equal(result.newToken, null, "Should not rotate if not yet due");
  assert.equal(result.rotated, false);
});

test("concurrent touches rotate a due session only once", async () => {
  const userId = crypto.randomUUID();
  const { sessionId } = await createTestSession(userId);
  await pool.query(
    `UPDATE sessions SET last_seen_at=now()-interval '6 minutes', rotated_at=now()-interval '6 minutes' WHERE id=$1`,
    [sessionId],
  );

  const results = await Promise.all(
    Array.from({ length: 8 }, () => touchSessionWithRotation(pool, sessionId, 5, true)),
  );
  assert.equal(results.filter((result) => result.rotated).length, 1);
  assert.equal(results.filter((result) => result.newToken).length, 1);
});

test("cleanupExpiredTokens removes old previous tokens", async () => {
  const userId = crypto.randomUUID();
  const { sessionId } = await createTestSession(userId);

  // Manually set previous_token to expired
  await pool.query(
    `UPDATE sessions 
     SET previous_token_hash = $1,
         previous_token_expires_at = now() - interval '60 seconds'
     WHERE id = $2`,
    [tokenHash("expired-token"), sessionId],
  );

  // Cleanup should clear it
  const cleaned = await cleanupExpiredTokens(pool);
  assert.equal(cleaned, 1, "Should have cleaned 1 session");

  const result = await pool.query("SELECT previous_token_hash FROM sessions WHERE id = $1", [sessionId]);
  assert.equal(result.rows[0].previous_token_hash, null, "Previous token should be cleared");
});

test("getRotationStats provides session metrics", async () => {
  const userId = crypto.randomUUID();

  // Create 3 sessions
  const { sessionId: s1 } = await createTestSession(userId);
  const { sessionId: s2 } = await createTestSession(userId);
  const { sessionId: s3 } = await createTestSession(userId);

  // Rotate one session to put it in grace period
  await rotateSessionToken(pool, s1);

  // Rotate another and expire it
  await rotateSessionToken(pool, s2);
  await pool.query(
    "UPDATE sessions SET previous_token_expires_at = now() - interval '60 seconds' WHERE id = $1",
    [s2],
  );

  const stats = await getRotationStats(pool);
  assert.equal(stats.total_sessions, 3, "Should count all 3 sessions");
  assert.equal(stats.sessions_in_grace_period, 1, "Should count 1 session in grace period (s1, not expired s2)");
});

test("authenticateSessionToken rejects expired sessions", async () => {
  const userId = crypto.randomUUID();
  const { token } = await createTestSession(userId, 0); // Expires immediately

  // Wait a bit and try to authenticate
  await new Promise((r) => setTimeout(r, 100));
  const session = await authenticateSessionToken(pool, token);
  assert.equal(session, null, "Should reject expired session");
});

test("authenticateSessionToken respects idle timeout", async () => {
  const userId = crypto.randomUUID();
  const { sessionId, token } = await createTestSession(userId);

  // Set last_seen_at to 31 minutes ago (exceeds 30 min idle)
  await pool.query(
    "UPDATE sessions SET last_seen_at = now() - interval '31 minutes' WHERE id = $1",
    [sessionId],
  );

  const session = await authenticateSessionToken(pool, token, 30);
  assert.equal(session, null, "Should reject idle session");
});
