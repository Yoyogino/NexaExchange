// server/advanced-orders-api.mjs
// Phase 5: REST API endpoints for advanced orders (stop-loss, take-profit,
// trailing stops, and order chains). Mounted at app.use("/api", ...) in
// index.mjs, behind the same requireSession + requireCsrf middleware as
// every other authenticated write route, so `req.userId` is always set.

import express from "express";
import { getMarketSnapshot, getRecentMarketTrades, OrderError } from "./matching.mjs";
import * as V from "./validation.mjs";
import {
  cancelAdvancedOrder,
  createOrderChain,
  createStopLossOrder,
  createTakeProfitOrder,
  getAdvancedOrderById,
  getOrderChain,
  getOrderChainsForTrade,
  getUserAdvancedOrders,
} from "./advanced-orders.mjs";
import { getTrailingStopHistory, getTrailingStopStats } from "./trailing-stops.mjs";

async function referencePrice(pool) {
  const snapshot = getMarketSnapshot();
  if (snapshot.bestBid) return snapshot.bestBid;
  const recent = await getRecentMarketTrades(pool, 1);
  return recent[0]?.price ?? null;
}

export function createAdvancedOrdersRouter(pool) {
  const router = express.Router();

  router.post("/orders/stop-loss", async (req, res, next) => {
    try {
      const { triggerPrice, quantity, notes } = req.body ?? {};
      const order = await createStopLossOrder(pool, req.userId, { triggerPrice, quantity, notes });
      res.status(201).json(order);
    } catch (error) {
      next(error);
    }
  });

  router.post("/orders/take-profit", async (req, res, next) => {
    try {
      const { triggerPrice, quantity, notes } = req.body ?? {};
      const order = await createTakeProfitOrder(pool, req.userId, { triggerPrice, quantity, notes });
      res.status(201).json(order);
    } catch (error) {
      next(error);
    }
  });

  router.post("/orders/trailing-stop", async (req, res, next) => {
    try {
      const { trailPercent, quantity, notes } = req.body ?? {};
      const { createTrailingStopOrder } = await import("./trailing-stops.mjs");
      const price = await referencePrice(pool);
      const order = await createTrailingStopOrder(pool, req.userId, { trailPercent, quantity, notes, referencePrice: price });
      res.status(201).json(order);
    } catch (error) {
      next(error);
    }
  });

  router.post("/orders/chains", async (req, res, next) => {
    try {
      const { parentTradeId, stopLoss, takeProfit, trailingStop } = req.body ?? {};
      let trailingStopInput = trailingStop;
      if (trailingStop) {
        trailingStopInput = { ...trailingStop, referencePrice: await referencePrice(pool) };
      }
      const chain = await createOrderChain(pool, req.userId, { parentTradeId, stopLoss, takeProfit, trailingStop: trailingStopInput });
      res.status(201).json(chain);
    } catch (error) {
      next(error);
    }
  });

  router.get("/orders/advanced", async (req, res, next) => {
    try {
      res.json(await getUserAdvancedOrders(pool, req.userId));
    } catch (error) {
      next(error);
    }
  });

  router.get("/orders/advanced/:orderId", async (req, res, next) => {
    try {
      V.uuid(req.params.orderId, "Order ID");
      res.json(await getAdvancedOrderById(pool, req.userId, req.params.orderId));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/orders/advanced/:orderId", async (req, res, next) => {
    try {
      V.uuid(req.params.orderId, "Order ID");
      res.json(await cancelAdvancedOrder(pool, req.userId, req.params.orderId));
    } catch (error) {
      next(error);
    }
  });

  router.get("/orders/chains/:chainId", async (req, res, next) => {
    try {
      V.uuid(req.params.chainId, "Chain ID");
      res.json(await getOrderChain(pool, req.userId, req.params.chainId));
    } catch (error) {
      next(error);
    }
  });

  router.get("/orders/trades/:tradeId/chains", async (req, res, next) => {
    try {
      V.uuid(req.params.tradeId, "Trade ID");
      res.json(await getOrderChainsForTrade(pool, req.userId, req.params.tradeId));
    } catch (error) {
      next(error);
    }
  });

  router.get("/orders/trailing-stops/:orderId/history", async (req, res, next) => {
    try {
      V.uuid(req.params.orderId, "Order ID");
      res.json(await getTrailingStopHistory(pool, req.userId, req.params.orderId));
    } catch (error) {
      next(error);
    }
  });

  router.get("/orders/trailing-stops/:orderId/stats", async (req, res, next) => {
    try {
      V.uuid(req.params.orderId, "Order ID");
      res.json(await getTrailingStopStats(pool, req.userId, req.params.orderId));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export { OrderError };
