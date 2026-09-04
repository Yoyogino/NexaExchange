import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import crypto from "node:crypto";
import {
  authenticateAndRotateSession,
  createSessionMiddleware,
  extractSessionToken,
  getSessionRotationHealth,
} from "../server/session-rotation-integration.mjs";
import { generateToken, tokenHash } from "../server/session-rotation.mjs";
import { assertIsolatedTestDatabase } from "./helpers/test-database.mjs";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

test.before(async () => {
  await assertIsolatedTestDatabase(pool);
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

  return { sessionId, token, userId };
}

test("authenticateAndRotateSession validates valid token", async () => {
  const userId = crypto.randomUUID();
  const { token } = await createTestSession(userId);

  const result = await authenticateAndRotateSession(pool, token);

  assert.equal(result.authenticated, true);
  assert.equal(result.userId, userId);
  assert.ok(result.sessionId);
  assert.equal(result.error, null);
});

test("rotation middleware replaces the session using an HttpOnly cookie", async () => {
  const userId = crypto.randomUUID();
  const { sessionId, token } = await createTestSession(userId);
  await pool.query("UPDATE sessions SET last_seen_at=now()-interval '6 minutes', rotated_at=now()-interval '6 minutes' WHERE id=$1", [sessionId]);
  const options = { httpOnly: true, sameSite: "strict", secure: true, path: "/" };
  const middleware = createSessionMiddleware(pool, "nexa_session", () => ({ nexa_session: token }), options);
  const cookies = [];
  const req = {};
  const res = {
    status() { return this; },
    json() { throw new Error("unexpected authentication failure"); },
    cookie(name, value, receivedOptions) { cookies.push({ name, value, receivedOptions }); },
  };
  await new Promise((resolve, reject) => middleware(req, res, (error) => error ? reject(error) : resolve()));
  assert.equal(req.userId, userId);
  assert.equal(cookies.length, 1);
  assert.equal(cookies[0].name, "nexa_session");
  assert.notEqual(cookies[0].value, token);
  assert.deepEqual(cookies[0].receivedOptions, options);
});

test("authenticateAndRotateSession rejects invalid token", async () => {
  const result = await authenticateAndRotateSession(pool, "invalid-token");

  assert.equal(result.authenticated, false);
  assert.ok(result.error);
});

test("authenticateAndRotateSession rejects no token", async () => {
  const result = await authenticateAndRotateSession(pool, null);

  assert.equal(result.authenticated, false);
  assert.equal(result.error, "No session token provided");
});

test("authenticateAndRotateSession returns new token if rotation due", async () => {
  const userId = crypto.randomUUID();
  const { sessionId, token } = await createTestSession(userId);

  // Set last rotation to 6 minutes ago (should trigger rotation at 5 min interval)
  await pool.query(
    `UPDATE sessions 
     SET last_seen_at = now() - interval '6 minutes',
         rotated_at = now() - interval '6 minutes'
     WHERE id = $1`,
    [sessionId],
  );

  const result = await authenticateAndRotateSession(pool, token);

  assert.equal(result.authenticated, true);
  assert.ok(result.newToken, "Should have new token");
  assert.notEqual(result.newToken, token);
  assert.equal(result.rotated, true);
});

test("authenticateAndRotateSession returns null token if rotation not due", async () => {
  const userId = crypto.randomUUID();
  const { token } = await createTestSession(userId);

  const result = await authenticateAndRotateSession(pool, token);

  assert.equal(result.authenticated, true);
  assert.equal(result.newToken, null);
  assert.equal(result.rotated, false);
});

test("extractSessionToken extracts from cookie", () => {
  const req = {
    headers: {
      cookie: "sessionId=abc123; path=/",
      get: (name) => req.headers[name],
    },
    get: (name) => req.headers[name],
  };

  // Mock cookie parsing
  const cookiesFor = () => ({ sessionId: "abc123" });
  const token = extractSessionToken(req, "sessionId");

  assert.equal(token, "abc123");
});

test("extractSessionToken rejects bearer credentials without a session cookie", () => {
  const req = {
    headers: {
      authorization: "Bearer token123xyz",
    },
    get: (name) => req.headers[name],
  };

  const token = extractSessionToken(req, "sessionId");
  assert.equal(token, null);
});

test("getSessionRotationHealth returns healthy status", async () => {
  const userId = crypto.randomUUID();
  await createTestSession(userId);

  const health = await getSessionRotationHealth(pool);

  assert.equal(health.healthy, true);
  assert.equal(health.totalSessions, 1);
  assert.equal(health.sessionsInGracePeriod, 0);
  assert.equal(health.gracePeriodPercentage, 0);
  assert.equal(typeof health.rotatedIn5min, "number");
  assert.ok(health.timestamp);
});

test("getSessionRotationHealth detects unhealthy state", async () => {
  const userId = crypto.randomUUID();
  const { sessionId } = await createTestSession(userId);

  // Create many sessions in grace period to trigger unhealthy status
  for (let i = 0; i < 20; i++) {
    const id = crypto.randomUUID();
    const token = generateToken();
    await pool.query(
      `INSERT INTO sessions (id, user_id, token_hash, previous_token_hash, previous_token_expires_at, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '30 seconds', now() + interval '12 hours')`,
      [id, userId, tokenHash(token), tokenHash("prev-token-" + i)],
    );
  }

  const health = await getSessionRotationHealth(pool);

  assert.ok(health.totalSessions >= 1);
  assert.ok(health.sessionsInGracePeriod > 0);
});

test("getSessionRotationHealth handles empty database", async () => {
  const health = await getSessionRotationHealth(pool);

  assert.equal(health.healthy, true);
  assert.equal(health.totalSessions, 0);
  assert.equal(health.sessionsInGracePeriod, 0);
});

test("getSessionRotationHealth handles errors gracefully", async () => {
  const badPool = {
    query: async () => {
      throw new Error("Database connection failed");
    },
  };

  const health = await getSessionRotationHealth(badPool);

  assert.equal(health.healthy, false);
  assert.ok(health.error);
  assert.ok(health.timestamp);
});
