import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import pg from "pg";
import { createClient } from "redis";
import { fundDemoBalance, getBalances, recordAudit, LedgerError } from "./ledger.mjs";
import {
  loadBook,
  getMarketSnapshot,
  placeOrder,
  cancelOrder,
  getOpenOrders,
  getOrderHistory,
  getTradeHistory,
  getRecentMarketTrades,
  OrderError,
} from "./matching.mjs";
import { createAdminRouter } from "./admin.mjs";
import { consumeTotp, createSecret, provisioningUri } from "./totp.mjs";
import * as V from "./validation.mjs";
import { createRateLimit } from "./rate-limit.mjs";
import { createMetrics } from "./metrics.mjs";
import { decryptSecret, encryptSecret, loadEncryptionKey } from "./secret-encryption.mjs";
import { createMailer } from "./mailer.mjs";
import { apiNoStore, assertProxyConfiguration, requireHttps, securityHeaders } from "./http-security.mjs";
import { SESSION_IDLE_MINUTES, SESSION_TOUCH_INTERVAL_MINUTES, sessionTokenFromRequest, shouldTouchSession } from "./session-policy.mjs";
import { assertMonitoringConfiguration, createMonitoringHandler } from "./monitoring.mjs";
import { hashPassword, verifyLoginPassword } from "./password.mjs";
import { createEventHub } from "./event-hub.mjs";
import { createSessionMiddleware, createCleanupMiddleware } from "./session-rotation-integration.mjs";
import { initializeApplicationSchema } from "./initialize-schema.mjs";
import { createCodeHasher } from "./code-hash.mjs";
import { CursorError } from "./cursor-pagination.mjs";
import { consumeEmailVerificationToken, consumeRecoveryCode, issueEmailVerificationToken, issuePasswordResetToken } from "./auth-tokens.mjs";
import { assertRestrictedRuntimePrivileges } from "./runtime-privileges.mjs";

assertProxyConfiguration();
assertMonitoringConfiguration();
const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await assertRestrictedRuntimePrivileges(pool);

const redis = createClient({ url: process.env.REDIS_URL });
redis.on("error", (error) => console.error(JSON.stringify({ event: "redis_error", message: error.message })));
const eventRedis = redis.duplicate();
eventRedis.on("error", (error) => console.error(JSON.stringify({ event: "redis_event_error", message: error.message })));
const rateLimit = createRateLimit(redis);
const metrics = createMetrics();
const encryptionKey = await loadEncryptionKey();
const codeHash = createCodeHasher(encryptionKey);
const mailer = createMailer();
const SESSION_LIFETIME_HOURS = 12;
const SESSION_COOKIE = "nexa_session";
const CSRF_COOKIE = "nexa_csrf";
const events = createEventHub();
const EVENT_CHANNEL = "nexa:exchange-events";
const instanceId = crypto.randomUUID();
let shuttingDown = false;
app.use(securityHeaders());
app.use(requireHttps());
app.use(createCleanupMiddleware(pool));
app.use(express.json({ limit: "16kb" }));
app.use("/api", apiNoStore());
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    metrics.record({ method: req.method, path: req.path, status: res.statusCode, durationMs });
    if (!(req.method === "GET" && res.statusCode === 304)) console.info(JSON.stringify({ event: "http_request", method: req.method, path: req.path, status: res.statusCode, durationMs }));
  });
  next();
});

// Demo funding grant given to every new account. Kept in one place so the
// amount is easy to change and easy to audit against ledger entries.
const DEMO_GRANT = [
  { asset: "BTC", amount: "1" },
  { asset: "USDT", amount: "10000" },
];

const tokenHash = (token) => crypto.createHash("sha256").update(token).digest("hex");
const createRecoveryCodes = () => Array.from({ length: 8 }, () => `${crypto.randomBytes(3).toString("hex").toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`);
async function replaceRecoveryCodes(client, userId) {
  const codes = createRecoveryCodes();
  await client.query("DELETE FROM recovery_codes WHERE user_id=$1", [userId]);
  for (const code of codes) await client.query("INSERT INTO recovery_codes (id,user_id,code_hash) VALUES ($1,$2,$3)", [crypto.randomUUID(), userId, codeHash(code)]);
  return codes;
}
async function verifySecondFactor(client, userId, secret, suppliedCode) {
  const code = String(suppliedCode ?? "").toUpperCase().replace(/\s/g, "");
  if (await consumeTotp(client, { userId, secret, code })) return true;
  if (!/^[A-F0-9]{6}-[A-F0-9]{6}$/.test(code)) return false;
  return consumeRecoveryCode(client, { userId, codeHash: codeHash(code) });
}
function cookiesFor(req) {
  const result = {};
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    try { result[decodeURIComponent(part.slice(0, separator).trim())] = decodeURIComponent(part.slice(separator + 1)); } catch { /* Ignore malformed browser cookies. */ }
  }
  return result;
}
const cookieOptions = { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", maxAge: SESSION_LIFETIME_HOURS * 60 * 60 * 1000, path: "/" };
async function createSession(client, userId, req) {
  const token = crypto.randomUUID();
  await client.query("INSERT INTO sessions (id, user_id, token_hash, expires_at, ip_address, user_agent) VALUES ($1,$2,$3,now() + ($4 || ' hours')::interval,$5,$6)", [crypto.randomUUID(), userId, tokenHash(token), String(SESSION_LIFETIME_HOURS), req.ip, req.get("user-agent") ?? null]);
  const csrfToken = crypto.randomBytes(32).toString("hex");
  return { token, csrfToken };
}
function setSessionCookies(res, { token, csrfToken }) {
  res.cookie(SESSION_COOKIE, token, cookieOptions);
  res.cookie(CSRF_COOKIE, csrfToken, { ...cookieOptions, httpOnly: false });
}
async function sessionFor(userId, req, res) {
  setSessionCookies(res, await createSession(pool, userId, req));
}

function requireCsrf(req, res, next) {
  const expected = cookiesFor(req)[CSRF_COOKIE];
  const supplied = req.get("x-csrf-token");
  if (!expected || !supplied || expected.length !== supplied.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return res.status(403).json({ error: "Security check failed. Refresh the page and try again." });
  next();
}

async function account(userId) {
  const user = await pool.query('SELECT email, role, trading_disabled AS "tradingDisabled", demo_grant_claimed AS "demoGrantClaimed", email_verified AS "emailVerified", two_factor_enabled AS "twoFactorEnabled" FROM users WHERE id = $1', [userId]);
  const wallets = await getBalances(pool, userId);
  return { user: user.rows[0], wallets };
}

// Session middleware with automatic token rotation
const requireSession = createSessionMiddleware(pool, SESSION_COOKIE, cookiesFor, cookieOptions);

app.post("/api/auth/register", rateLimit({ windowMs: 60_000, limit: 5, scope: "register" }), async (req, res, next) => {
  let email, password;
  try { email = V.email(req.body?.email); password = V.password(req.body?.password); } catch (error) { return res.status(400).json({ error: error.message }); }
  const client = await pool.connect();
  try {
    const userId = crypto.randomUUID();
    await client.query("BEGIN");
    await client.query("INSERT INTO users (id, email, password_hash, demo_grant_claimed) VALUES ($1, $2, $3, true)", [userId, email, await hashPassword(password)]);
    for (const grant of DEMO_GRANT) {
      await fundDemoBalance(client, { userId, asset: grant.asset, amount: grant.amount, reason: "New account demo funding" });
    }
    await recordAudit(client, { actorUserId: userId, action: "user.registered", targetType: "user", targetId: userId, metadata: { email } });
    await client.query("COMMIT");
    await sessionFor(userId, req, res);
    res.status(201).json(await account(userId));
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") return res.status(409).json({ error: "An account already exists for that email." });
    next(error);
  } finally {
    client.release();
  }
});

app.post("/api/auth/login", rateLimit({ windowMs: 60_000, limit: 20, scope: "login-ip" }), rateLimit({ windowMs: 60_000, limit: 10, scope: "login-account", identity: (req) => String(req.body?.email ?? "").trim().toLowerCase().slice(0, 254) }), async (req, res, next) => {
  let client;
  try {
    const email = V.email(req.body?.email);
    const password = V.password(req.body?.password);
    const result = await pool.query("SELECT id, password_hash, two_factor_enabled, two_factor_secret FROM users WHERE email = $1", [email]);
    const user = result.rows[0];
    if (!await verifyLoginPassword(password, user?.password_hash)) {
      if (user) await pool.query("INSERT INTO login_history (id,user_id,succeeded,ip_address,user_agent) VALUES ($1,$2,false,$3,$4)", [crypto.randomUUID(), user.id, req.ip, req.get("user-agent") ?? null]);
      return res.status(401).json({ error: "Email or password is incorrect." });
    }
    client = await pool.connect();
    await client.query("BEGIN");
    if (user.two_factor_enabled) {
      const valid = await verifySecondFactor(client, user.id, decryptSecret(user.two_factor_secret, encryptionKey), req.body?.twoFactorCode);
      if (!valid) {
        await client.query("ROLLBACK");
        client.release(); client = null;
        await pool.query("INSERT INTO login_history (id,user_id,succeeded,ip_address,user_agent) VALUES ($1,$2,false,$3,$4)", [crypto.randomUUID(), user.id, req.ip, req.get("user-agent") ?? null]);
        return res.status(401).json({ error: "Enter your authenticator or recovery code.", code: "TWO_FACTOR_REQUIRED" });
      }
    }
    await client.query("INSERT INTO login_history (id,user_id,succeeded,ip_address,user_agent) VALUES ($1,$2,true,$3,$4)", [crypto.randomUUID(), user.id, req.ip, req.get("user-agent") ?? null]);
    const session = await createSession(client, user.id, req);
    await client.query("COMMIT");
    client.release(); client = null;
    setSessionCookies(res, session);
    res.json(await account(user.id));
  } catch (error) {
    if (client) { await client.query("ROLLBACK"); client.release(); }
    next(error);
  }
});

app.get("/api/me", requireSession, async (req, res, next) => {
  try {
    res.json(await account(req.userId));
  } catch (error) {
    next(error);
  }
});
app.post("/api/demo-funding/claim", requireSession, requireCsrf, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query("SELECT demo_grant_claimed AS \"demoGrantClaimed\" FROM users WHERE id = $1 FOR UPDATE", [req.userId]);
    if (user.rows[0]?.demoGrantClaimed) { await client.query("ROLLBACK"); return res.status(409).json({ error: "Demo funds have already been claimed." }); }
    for (const grant of DEMO_GRANT) await fundDemoBalance(client, { userId: req.userId, asset: grant.asset, amount: grant.amount, reason: "Legacy account demo funding" });
    await client.query("UPDATE users SET demo_grant_claimed = true WHERE id = $1", [req.userId]);
    await recordAudit(client, { actorUserId: req.userId, action: "demo_funding.claimed", targetType: "user", targetId: req.userId });
    await client.query("COMMIT");
    res.json(await account(req.userId));
  } catch (error) { await client.query("ROLLBACK"); next(error); } finally { client.release(); }
});
app.post("/api/auth/logout", requireSession, requireCsrf, async (req, res, next) => {
  try { await pool.query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [req.sessionId]); res.clearCookie(SESSION_COOKIE, { path: "/" }); res.clearCookie(CSRF_COOKIE, { path: "/" }); res.status(204).end(); } catch (error) { next(error); }
});

app.post("/api/auth/email-verification/request", requireSession, requireCsrf, rateLimit({ windowMs: 60_000, limit: 3, scope: "email-verification-request" }), async (req, res, next) => {
  let client;
  try {
    const code = String(crypto.randomInt(100000, 1000000));
    client = await pool.connect();
    await client.query("BEGIN");
    const user = await client.query("SELECT email FROM users WHERE id = $1", [req.userId]);
    await issueEmailVerificationToken(client, { userId: req.userId, codeHash: codeHash(code) });
    await client.query("COMMIT");
    client.release(); client = null;
    const delivery = await mailer.sendVerificationCode(user.rows[0].email, code);
    res.json({ ...delivery, ...(delivery.delivery === "local-demo" ? { demoCode: code } : {}), expiresInMinutes: 15 });
  } catch (error) { if (client) { await client.query("ROLLBACK"); client.release(); } next(error); }
});

app.post("/api/auth/email-verification/confirm", requireSession, requireCsrf, rateLimit({ windowMs: 60_000, limit: 10, scope: "email-verification-confirm" }), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const code = String(req.body?.code ?? "");
    await client.query("BEGIN");
    if (!await consumeEmailVerificationToken(client, { userId: req.userId, codeHash: codeHash(code) })) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Verification code is invalid or expired." });
    }
    await client.query("UPDATE users SET email_verified = true WHERE id = $1", [req.userId]);
    await recordAudit(client, { actorUserId: req.userId, action: "email.verified", targetType: "user", targetId: req.userId });
    await client.query("COMMIT");
    res.json(await account(req.userId));
  } catch (error) { await client.query("ROLLBACK"); next(error); } finally { client.release(); }
});

app.post("/api/auth/password-reset/request", rateLimit({ windowMs: 60_000, limit: 10, scope: "password-reset-request-ip" }), rateLimit({ windowMs: 60_000, limit: 3, scope: "password-reset-request-account", identity: (req) => String(req.body?.email ?? "").trim().toLowerCase().slice(0, 254) }), async (req, res, next) => {
  let client;
  try {
    const email = V.email(req.body?.email);
    const user = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (!user.rows[0]) return res.json({ message: "If the account exists, reset instructions were sent.", delivery: mailer.configured ? "email" : "local-demo", expiresInMinutes: 15 });
    const code = String(crypto.randomInt(100000, 1000000));
    client = await pool.connect();
    await client.query("BEGIN");
    await issuePasswordResetToken(client, { userId: user.rows[0].id, codeHash: codeHash(code) });
    await client.query("COMMIT");
    client.release(); client = null;
    const delivery = await mailer.sendPasswordResetCode(email, code);
    res.json({ message: "If the account exists, reset instructions were sent.", ...delivery, ...(delivery.delivery === "local-demo" ? { demoCode: code } : {}), expiresInMinutes: 15 });
  } catch (error) { if (client) { await client.query("ROLLBACK"); client.release(); } next(error); }
});

app.post("/api/auth/password-reset/confirm", rateLimit({ windowMs: 60_000, limit: 20, scope: "password-reset-confirm-ip" }), rateLimit({ windowMs: 60_000, limit: 10, scope: "password-reset-confirm-account", identity: (req) => String(req.body?.email ?? "").trim().toLowerCase().slice(0, 254) }), async (req, res, next) => {
  let email, code, password;
  try { email = V.email(req.body?.email); code = V.shortCode(req.body?.code, "Reset code"); password = V.password(req.body?.password); } catch (error) { return res.status(400).json({ error: error.message }); }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT p.user_id FROM password_reset_tokens p JOIN users u ON u.id=p.user_id WHERE u.email=$1 AND p.code_hash=$2 AND p.expires_at>now() FOR UPDATE", [email, codeHash(code)]);
    if (!result.rows[0]) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Reset code is invalid or expired." }); }
    const userId = result.rows[0].user_id;
    await client.query("UPDATE users SET password_hash=$1 WHERE id=$2", [await hashPassword(password), userId]);
    await client.query("DELETE FROM password_reset_tokens WHERE user_id=$1", [userId]);
    await client.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [userId]);
    await recordAudit(client, { actorUserId: userId, action: "password.reset_completed", targetType: "user", targetId: userId });
    await client.query("COMMIT"); res.json({ message: "Password reset. Sign in with your new password." });
  } catch (error) { await client.query("ROLLBACK"); next(error); } finally { client.release(); }
});

app.post("/api/security/2fa/setup", requireSession, requireCsrf, async (req, res, next) => {
  try {
    const user = await pool.query("SELECT email,email_verified,two_factor_enabled FROM users WHERE id=$1", [req.userId]);
    if (!user.rows[0]?.email_verified) return res.status(403).json({ error: "Verify your email before enabling two-factor authentication." });
    if (user.rows[0].two_factor_enabled) return res.status(409).json({ error: "Two-factor authentication is already enabled." });
    const secret = createSecret(); await pool.query("UPDATE users SET two_factor_secret=$1,two_factor_last_counter=NULL WHERE id=$2", [encryptSecret(secret, encryptionKey), req.userId]);
    res.json({ secret, provisioningUri: provisioningUri(user.rows[0].email, secret) });
  } catch (error) { next(error); }
});

app.post("/api/security/2fa/confirm", requireSession, requireCsrf, rateLimit({ windowMs: 60_000, limit: 10, scope: "two-factor-confirm" }), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN"); const user = await client.query("SELECT two_factor_secret FROM users WHERE id=$1 FOR UPDATE", [req.userId]);
    if (!user.rows[0]?.two_factor_secret || !await consumeTotp(client, { userId: req.userId, secret: decryptSecret(user.rows[0].two_factor_secret, encryptionKey), code: String(req.body?.code ?? "") })) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Authenticator code is invalid." }); }
    const codes = await replaceRecoveryCodes(client, req.userId);
    await client.query("UPDATE users SET two_factor_enabled=true WHERE id=$1", [req.userId]);
    await recordAudit(client, { actorUserId: req.userId, action: "two_factor.enabled", targetType: "user", targetId: req.userId });
    await client.query("COMMIT"); res.json({ recoveryCodes: codes, account: await account(req.userId) });
  } catch (error) { await client.query("ROLLBACK"); next(error); } finally { client.release(); }
});

app.post("/api/security/2fa/recovery-codes", requireSession, requireCsrf, rateLimit({ windowMs: 60_000, limit: 5, scope: "two-factor-recovery" }), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query("SELECT two_factor_enabled,two_factor_secret FROM users WHERE id=$1 FOR UPDATE", [req.userId]);
    if (!user.rows[0]?.two_factor_enabled || !await verifySecondFactor(client, req.userId, decryptSecret(user.rows[0].two_factor_secret, encryptionKey), req.body?.code)) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Authenticator or recovery code is invalid." }); }
    const recoveryCodes = await replaceRecoveryCodes(client, req.userId);
    await recordAudit(client, { actorUserId: req.userId, action: "two_factor.recovery_codes_regenerated", targetType: "user", targetId: req.userId });
    await client.query("COMMIT"); res.json({ recoveryCodes });
  } catch (error) { await client.query("ROLLBACK"); next(error); } finally { client.release(); }
});

app.post("/api/security/2fa/disable", requireSession, requireCsrf, rateLimit({ windowMs: 60_000, limit: 5, scope: "two-factor-disable" }), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query("SELECT two_factor_enabled,two_factor_secret FROM users WHERE id=$1 FOR UPDATE", [req.userId]);
    if (!user.rows[0]?.two_factor_enabled || !await verifySecondFactor(client, req.userId, decryptSecret(user.rows[0].two_factor_secret, encryptionKey), req.body?.code)) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Authenticator or recovery code is invalid." }); }
    await client.query("UPDATE users SET two_factor_enabled=false,two_factor_secret=NULL,two_factor_last_counter=NULL WHERE id=$1", [req.userId]);
    await client.query("DELETE FROM recovery_codes WHERE user_id=$1", [req.userId]);
    await client.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL", [req.userId, req.sessionId]);
    await recordAudit(client, { actorUserId: req.userId, action: "two_factor.disabled", targetType: "user", targetId: req.userId });
    await client.query("COMMIT"); res.json(await account(req.userId));
  } catch (error) { await client.query("ROLLBACK"); next(error); } finally { client.release(); }
});

app.get("/api/security/sessions", requireSession, async (req, res, next) => { try { const result = await pool.query(`SELECT id,created_at AS "createdAt",last_seen_at AS "lastSeenAt",expires_at AS "expiresAt",ip_address AS "ipAddress",user_agent AS "userAgent",id=$2 AS "current" FROM sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now() AND last_seen_at > now() - ('30 minutes')::interval ORDER BY created_at DESC`, [req.userId, req.sessionId]); res.json(result.rows); } catch (error) { next(error); } });
app.delete("/api/security/sessions/:id", requireSession, requireCsrf, async (req, res, next) => { try { const sessionId = V.uuid(req.params.id, "Session ID"); const result = await pool.query("UPDATE sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id", [sessionId, req.userId]); if (!result.rows[0]) return res.status(404).json({ error: "Session not found." }); res.status(204).end(); } catch (error) { next(error); } });
app.get("/api/security/login-history", requireSession, async (req, res, next) => { try { const result = await pool.query('SELECT id,succeeded,ip_address AS "ipAddress",user_agent AS "userAgent",created_at AS "createdAt" FROM login_history WHERE user_id=$1 ORDER BY created_at DESC LIMIT 25', [req.userId]); res.json(result.rows); } catch (error) { next(error); } });

app.get("/metrics", createMonitoringHandler({ metrics, pool, redis }));
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.get("/api/ready", async (_req, res, next) => {
  if (shuttingDown) return res.status(503).json({ status: "shutting_down" });
  try {
    await Promise.all([pool.query("SELECT 1"), redis.ping()]);
    res.json({ status: "ready", database: "ok", redis: "ok" });
  } catch (error) { next(error); }
});
// --- Market, orders, and trades --------------------------------------------

app.get("/api/market", (_req, res) => {
  res.json(getMarketSnapshot());
});
app.get("/api/market/trades", async (_req, res, next) => { try { res.json(await getRecentMarketTrades(pool)); } catch (error) { next(error); } });
app.get("/api/events", requireSession, (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write("event: connected\ndata: {}\n\n");
  const unsubscribe = events.subscribe(req.userId, res);
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 25_000);
  req.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
});

app.post("/api/orders", requireSession, requireCsrf, rateLimit({ windowMs: 10_000, limit: 20, scope: "orders" }), async (req, res, next) => {
  try {
    const { side, type, price, quantity } = req.body ?? {};
    const idempotencyKey = V.uuid(req.get("idempotency-key"), "Idempotency key");
    const placed = await placeOrder(pool, { userId: req.userId, side, type, price, quantity, idempotencyKey });
    const { affectedUserIds, ...result } = placed;
    events.publish("market");
    events.publish("account", affectedUserIds);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/orders/:id", requireSession, requireCsrf, async (req, res, next) => {
  try {
    V.uuid(req.params.id, "Order ID");
    const result = await cancelOrder(pool, { userId: req.userId, orderId: req.params.id });
    events.publish("market");
    events.publish("account", [req.userId]);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/orders", requireSession, async (req, res, next) => {
  try {
    res.json(await getOpenOrders(pool, req.userId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/orders/history", requireSession, async (req, res, next) => {
  try {
    res.json(await getOrderHistory(pool, req.userId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/trades", requireSession, async (req, res, next) => {
  try {
    res.json(await getTradeHistory(pool, req.userId));
  } catch (error) {
    next(error);
  }
});

app.use("/api/admin", requireSession, (req, res, next) => ["GET", "HEAD", "OPTIONS"].includes(req.method) ? next() : requireCsrf(req, res, next), createAdminRouter(pool, { redis, metrics, events }));

if (process.env.NODE_ENV === "production") {
  const clientDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
  app.use(express.static(clientDirectory, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => res.sendFile(path.join(clientDirectory, "index.html")));
}

app.use((error, _req, res, _next) => {
  if (error instanceof OrderError || error instanceof LedgerError || error instanceof V.ValidationError || error instanceof CursorError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(error);
  res.status(500).json({ error: "Something went wrong." });
});

if (process.env.RUN_MIGRATIONS !== "0") await initializeApplicationSchema(pool, encryptionKey);
await loadBook(pool);
await redis.connect();
await eventRedis.connect();
events.setFanout(({ event, userIds }) => redis.publish(EVENT_CHANNEL, JSON.stringify({ origin: instanceId, event, userIds })));
await eventRedis.subscribe(EVENT_CHANNEL, async (message) => {
  try {
    const update = JSON.parse(message);
    if (update.origin !== instanceId && typeof update.event === "string") {
      if (update.event === "market") await loadBook(pool);
      events.deliver(update.event, Array.isArray(update.userIds) ? update.userIds : null);
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "redis_event_invalid", message: error.message }));
  }
});
const port = Number.parseInt(process.env.PORT ?? "3001", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535.");
const server = app.listen(port, () => console.log(`Demo account API listening on http://localhost:${port}`));
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(JSON.stringify({ event: "shutdown_started", signal }));
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  events.close();
  server.close(async () => {
    try {
      if (eventRedis.isOpen) await eventRedis.quit();
      if (redis.isOpen) await redis.quit();
      await pool.end();
      clearTimeout(forceExit);
      console.info(JSON.stringify({ event: "shutdown_complete", signal }));
      process.exit(0);
    }
    catch (error) { console.error(error); process.exit(1); }
  });
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
