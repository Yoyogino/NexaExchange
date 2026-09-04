// Admin API: read-only visibility into every user/order/trade/audit event on
// the exchange, plus a small set of operator controls (pause the market,
// disable a user's trading, adjust a user's simulated balance). Mounted at
// /api/admin in server/index.mjs, behind the same session middleware as
// everything else, plus the role check below.
//
// Every control action here goes through the ledger (adjustBalance) or an
// explicit column (trading_disabled, markets.status) and is recorded as an
// audit event — there is no "just edit the database" path, on purpose:
// PRODUCT_REQUIREMENTS.md's non-negotiables apply to admins too.

import express from "express";
import { adjustBalance, getBalances, recordAudit, LedgerError, ASSETS } from "./ledger.mjs";
import { getAllOrders, getAllTrades, getMarketSnapshot, setMarketStatus } from "./matching.mjs";
import * as V from "./validation.mjs";
import { getSessionRotationHealth } from "./session-rotation-integration.mjs";
import { cursorPage, decodeCursor } from "./cursor-pagination.mjs";

export function createAdminRouter(pool, dependencies = {}) {
  const router = express.Router();
  const pagination = (req) => ({ cursor: typeof req.query.cursor === "string" ? req.query.cursor : null, limit: Math.min(50, Math.max(1, Number.parseInt(String(req.query.limit ?? "12"), 10) || 12)) });

  router.use(async (req, res, next) => {
    try {
      const result = await pool.query("SELECT role FROM users WHERE id = $1", [req.userId]);
      if (result.rows[0]?.role !== "ADMIN") {
        return res.status(403).json({ error: "Admin access required." });
      }
      next();
    } catch (error) {
      next(error);
    }
  });

  router.get("/users", async (req, res, next) => {
    try {
      const limit = Math.min(50, Math.max(1, Number.parseInt(String(req.query.limit ?? "10"), 10) || 10));
      const search = String(req.query.search ?? "").trim().slice(0, 254);
      const cursor = decodeCursor(typeof req.query.cursor === "string" ? req.query.cursor : null);
      const conditions = [];
      const parameters = [];
      if (search) { parameters.push(`%${search.replace(/[\\%_]/g, "\\$&")}%`); conditions.push(`email ILIKE $${parameters.length}`); }
      if (cursor) { parameters.push(cursor.createdAt, cursor.id); conditions.push(`(created_at, id) < ($${parameters.length - 1}, $${parameters.length})`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const countWhere = search ? "WHERE email ILIKE $1" : "";
      const countParameters = search ? [parameters[0]] : [];
      parameters.push(limit + 1);
      const users = await pool.query(
        `SELECT id, email, role, trading_disabled AS "tradingDisabled", created_at AS "createdAt" FROM users ${where} ORDER BY created_at DESC, id DESC LIMIT $${parameters.length}`,
        parameters,
      );
      const count = await pool.query(`SELECT count(*)::int AS total FROM users ${countWhere}`, countParameters);
      const page = cursorPage(users.rows, limit);
      const withBalances = await Promise.all(
        page.items.map(async (user) => ({ ...user, wallets: await getBalances(pool, user.id) })),
      );
      res.json({ ...page, items: withBalances, total: count.rows[0].total });
    } catch (error) {
      next(error);
    }
  });

  router.get("/orders", async (req, res, next) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : null;
      if (status && !["OPEN", "PARTIALLY_FILLED", "FILLED", "CANCELLED"].includes(status)) return res.status(400).json({ error: "Order status is invalid." });
      res.json(await getAllOrders(pool, { status, ...pagination(req) }));
    } catch (error) {
      next(error);
    }
  });

  router.get("/trades", async (req, res, next) => {
    try {
      res.json(await getAllTrades(pool, pagination(req)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/audit", async (req, res, next) => {
    try {
      const { cursor: rawCursor, limit } = pagination(req);
      const cursor = decodeCursor(rawCursor);
      const count = await pool.query("SELECT count(*)::int AS total FROM audit_events");
      const where = cursor ? "WHERE (a.created_at, a.id) < ($1, $2)" : "";
      const parameters = cursor ? [cursor.createdAt, cursor.id, limit + 1] : [limit + 1];
      const result = await pool.query(
        `SELECT a.id, a.action, a.target_type AS "targetType", a.target_id AS "targetId", a.metadata,
                a.created_at AS "createdAt", actor.email AS "actorEmail"
         FROM audit_events a
         LEFT JOIN users actor ON actor.id = a.actor_user_id
         ${where}
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT $${parameters.length}`, parameters,
      );
      res.json({ ...cursorPage(result.rows, limit), total: count.rows[0].total });
    } catch (error) {
      next(error);
    }
  });

  router.get("/market", (_req, res) => {
    res.json(getMarketSnapshot());
  });

  router.get("/session-health", async (_req, res, next) => {
    try {
      const health = await getSessionRotationHealth(pool);
      res.status(health.healthy ? 200 : 503).json(health);
    } catch (error) { next(error); }
  });

  router.get("/system-health", async (_req, res, next) => {
    try {
      const databaseStarted = performance.now(); await pool.query("SELECT 1"); const databaseLatencyMs = Math.round(performance.now() - databaseStarted);
      const redisStarted = performance.now(); await dependencies.redis?.ping(); const redisLatencyMs = Math.round(performance.now() - redisStarted);
      const memory = process.memoryUsage();
      res.json({ status: "healthy", checkedAt: new Date().toISOString(), database: { status: "ok", latencyMs: databaseLatencyMs }, redis: { status: "ok", latencyMs: redisLatencyMs }, process: { uptimeSeconds: Math.floor(process.uptime()), memoryMb: Math.round(memory.rss / 1024 / 1024) }, metrics: dependencies.metrics?.snapshot() ?? null });
    } catch (error) { next(error); }
  });

  router.post("/market/pause", async (req, res, next) => {
    try {
      const result = await setMarketStatus(pool, "PAUSED");
      await recordAudit(pool, { actorUserId: req.userId, action: "market.paused", targetType: "market", targetId: result.marketId });
      dependencies.events?.publish("market");
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/market/resume", async (req, res, next) => {
    try {
      const result = await setMarketStatus(pool, "ACTIVE");
      await recordAudit(pool, { actorUserId: req.userId, action: "market.resumed", targetType: "market", targetId: result.marketId });
      dependencies.events?.publish("market");
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/users/:id/trading", async (req, res, next) => {
    try {
      const userId = V.uuid(req.params.id, "User ID");
      const disabled = V.boolean(req.body?.disabled, "Disabled");
      const result = await pool.query(
        'UPDATE users SET trading_disabled = $1 WHERE id = $2 RETURNING id, email, trading_disabled AS "tradingDisabled"',
        [disabled, userId],
      );
      if (!result.rows[0]) return res.status(404).json({ error: "User not found." });
      await recordAudit(pool, {
        actorUserId: req.userId,
        action: disabled ? "user.trading_disabled" : "user.trading_enabled",
        targetType: "user",
        targetId: userId,
      });
      dependencies.events?.publish("account", [userId]);
      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  router.post("/users/:id/adjust-balance", async (req, res, next) => {
    const { asset, amount, reason } = req.body ?? {};
    if (!ASSETS.includes(asset)) return res.status(400).json({ error: "Asset must be BTC or USDT." });
    let userId, cleanReason;
    try { userId = V.uuid(req.params.id, "User ID"); cleanReason = V.text(reason, "Adjustment reason", 500); } catch (error) { return res.status(400).json({ error: error.message }); }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const userExists = await client.query("SELECT id, email FROM users WHERE id = $1", [userId]);
      if (!userExists.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "User not found." });
      }
      await adjustBalance(client, { userId, asset, amount: String(amount), reason: cleanReason, actorUserId: req.userId });
      await recordAudit(client, {
        actorUserId: req.userId,
        action: "user.balance_adjusted",
        targetType: "user",
        targetId: userId,
        metadata: { asset, amount: String(amount), reason: cleanReason },
      });
      await client.query("COMMIT");
      dependencies.events?.publish("account", [userId]);
      res.json({ userId, wallets: await getBalances(pool, userId) });
    } catch (error) {
      await client.query("ROLLBACK");
      // adjustBalance's own validation (bad decimal string, zero amount)
      // throws a plain Error or LedgerError, not an OrderError — the global
      // handler in server/index.mjs only knows about those two, so surface
      // anything else here as a 400 instead of letting it fall through to a
      // generic 500 for what's really an input-validation problem.
      if (error instanceof LedgerError) return res.status(error.status).json({ error: error.message });
      if (error.name === "Error") return res.status(400).json({ error: error.message });
      next(error);
    } finally {
      client.release();
    }
  });

  return router;
}
