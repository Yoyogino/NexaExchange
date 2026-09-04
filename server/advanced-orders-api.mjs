// server/advanced-orders-api.mjs
// Phase 5: REST API endpoints for advanced orders

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as advOrders from './advanced-orders.mjs';
import * as trailingStops from './trailing-stops.mjs';
import { db } from './db.mjs';
import Decimal from 'decimal.js';

const router = express.Router();

/**
 * POST /api/orders/stop-loss
 * Create a stop-loss order
 */
router.post('/orders/stop-loss', async (req, res) => {
  try {
    const { marketId, triggerPrice, quantity, notes } = req.body;
    const userId = req.user.id;

    // Validation
    if (!marketId || !triggerPrice || !quantity) {
      return res.status(400).json({ 
        error: 'Missing required fields: marketId, triggerPrice, quantity' 
      });
    }

    if (new Decimal(triggerPrice).lessThanOrEqualTo(0)) {
      return res.status(400).json({ error: 'Trigger price must be positive' });
    }

    if (new Decimal(quantity).lessThanOrEqualTo(0)) {
      return res.status(400).json({ error: 'Quantity must be positive' });
    }

    const order = await advOrders.createStopLossOrder(
      userId,
      marketId,
      triggerPrice,
      quantity,
      notes
    );

    res.status(201).json({
      success: true,
      data: order
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/orders/take-profit
 * Create a take-profit order
 */
router.post('/orders/take-profit', async (req, res) => {
  try {
    const { marketId, triggerPrice, quantity, notes } = req.body;
    const userId = req.user.id;

    if (!marketId || !triggerPrice || !quantity) {
      return res.status(400).json({ 
        error: 'Missing required fields: marketId, triggerPrice, quantity' 
      });
    }

    if (new Decimal(triggerPrice).lessThanOrEqualTo(0)) {
      return res.status(400).json({ error: 'Trigger price must be positive' });
    }

    if (new Decimal(quantity).lessThanOrEqualTo(0)) {
      return res.status(400).json({ error: 'Quantity must be positive' });
    }

    const order = await advOrders.createTakeProfitOrder(
      userId,
      marketId,
      triggerPrice,
      quantity,
      notes
    );

    res.status(201).json({
      success: true,
      data: order
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/orders/trailing-stop
 * Create a trailing stop order
 */
router.post('/orders/trailing-stop', async (req, res) => {
  try {
    const { marketId, trailPercentage, quantity, notes } = req.body;
    const userId = req.user.id;

    if (!marketId || !trailPercentage || !quantity) {
      return res.status(400).json({ 
        error: 'Missing required fields: marketId, trailPercentage, quantity' 
      });
    }

    if (new Decimal(trailPercentage).lessThanOrEqualTo(0) || new Decimal(trailPercentage).greaterThan(100)) {
      return res.status(400).json({ error: 'Trail percentage must be between 0 and 100' });
    }

    if (new Decimal(quantity).lessThanOrEqualTo(0)) {
      return res.status(400).json({ error: 'Quantity must be positive' });
    }

    // Get current market price
    const marketResult = await db.query(
      'SELECT id FROM markets WHERE id = $1',
      [marketId]
    );

    if (!marketResult.rows.length) {
      return res.status(404).json({ error: 'Market not found' });
    }

    // Get latest trade price for this market
    const priceResult = await db.query(
      `SELECT price FROM trades 
       WHERE market_id = $1 AND status = 'FILLED'
       ORDER BY created_at DESC LIMIT 1`,
      [marketId]
    );

    if (!priceResult.rows.length) {
      return res.status(400).json({ error: 'No price data available for this market' });
    }

    const currentPrice = priceResult.rows[0].price;

    const order = await trailingStops.createTrailingStop(
      userId,
      marketId,
      trailPercentage,
      currentPrice,
      quantity,
      notes
    );

    res.status(201).json({
      success: true,
      data: order,
      info: {
        currentPrice,
        trailPercentage,
        initialTriggerPrice: order.trigger_value
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/orders/chains
 * Create an order chain (link SL + TP + Trailing)
 */
router.post('/orders/chains', async (req, res) => {
  try {
    const { parentTradeId, stopLossId, takeProfitId, trailingStopId } = req.body;
    const userId = req.user.id;

    if (!parentTradeId) {
      return res.status(400).json({ error: 'Missing required field: parentTradeId' });
    }

    if (!stopLossId && !takeProfitId && !trailingStopId) {
      return res.status(400).json({ 
        error: 'At least one order must be specified' 
      });
    }

    const chain = await advOrders.createOrderChain(
      userId,
      parentTradeId,
      stopLossId,
      takeProfitId,
      trailingStopId
    );

    res.status(201).json({
      success: true,
      data: chain
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/orders/advanced
 * Get all active advanced orders for user
 */
router.get('/orders/advanced', async (req, res) => {
  try {
    const userId = req.user.id;
    const orders = await advOrders.getActiveOrders(userId);

    res.json({
      success: true,
      count: orders.length,
      data: orders
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/orders/advanced/:orderId
 * Get details of a specific advanced order
 */
router.get('/orders/advanced/:orderId', async (req, res) => {
  try {
    const order = await advOrders.getAdvancedOrder(req.params.orderId);

    // Verify ownership
    if (order.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    res.json({
      success: true,
      data: order
    });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

/**
 * GET /api/orders/chains/:parentTradeId
 * Get order chains for a parent trade
 */
router.get('/orders/chains/:parentTradeId', async (req, res) => {
  try {
    const chains = await advOrders.getOrderChains(req.params.parentTradeId);

    res.json({
      success: true,
      count: chains.length,
      data: chains
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/orders/trailing-stops/:orderId/history
 * Get trailing stop adjustment history
 */
router.get('/orders/trailing-stops/:orderId/history', async (req, res) => {
  try {
    const history = await trailingStops.getTrailingStopHistory(req.params.orderId);

    res.json({
      success: true,
      count: history.length,
      data: history
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/orders/trailing-stops/:orderId/stats
 * Get trailing stop performance statistics
 */
router.get('/orders/trailing-stops/:orderId/stats', async (req, res) => {
  try {
    const stats = await trailingStops.getTrailingStopStats(req.params.orderId);

    res.json({
      success: true,
      data: stats
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/orders/advanced/:orderId
 * Cancel an advanced order
 */
router.delete('/orders/advanced/:orderId', async (req, res) => {
  try {
    const order = await advOrders.getAdvancedOrder(req.params.orderId);

    // Verify ownership
    if (order.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Check order type and cancel appropriately
    let canceled;
    switch (order.order_type) {
      case 'STOP_LOSS':
        canceled = await advOrders.cancelStopLoss(req.params.orderId);
        break;
      case 'TAKE_PROFIT':
        canceled = await advOrders.cancelTakeProfit(req.params.orderId);
        break;
      case 'TRAILING_STOP':
        canceled = await trailingStops.cancelTrailingStop(req.params.orderId);
        break;
      default:
        return res.status(400).json({ error: 'Unknown order type' });
    }

    res.json({
      success: true,
      message: 'Order canceled',
      data: canceled
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
