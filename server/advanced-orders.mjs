// server/advanced-orders.mjs
// Phase 5: Stop-Loss, Take-Profit, and Trailing Stop Orders

import { db } from './db.mjs';
import { v4 as uuidv4 } from 'uuid';
import Decimal from 'decimal.js';

/**
 * Advanced Orders Module
 * Handles stop-loss, take-profit, and trailing stop order logic
 */

// ============================================================================
// STOP-LOSS ORDERS
// ============================================================================

/**
 * Create a stop-loss order
 * @param {string} userId - User ID
 * @param {string} marketId - Market ID  
 * @param {number} triggerPrice - Price at which to trigger the order
 * @param {number} quantity - Quantity to sell
 * @param {string} notes - Optional notes
 * @returns {object} Created advanced order
 */
export async function createStopLossOrder(userId, marketId, triggerPrice, quantity, notes = '') {
  const orderId = uuidv4();
  
  const result = await db.query(
    `INSERT INTO advanced_orders 
     (id, user_id, market_id, order_type, order_side, trigger_type, trigger_value, quantity, notes, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [orderId, userId, marketId, 'STOP_LOSS', 'SELL', 'PRICE', triggerPrice, quantity, notes, 'ACTIVE']
  );
  
  return result.rows[0];
}

/**
 * Check if a stop-loss order should be triggered
 * @param {object} advancedOrder - Advanced order object
 * @param {number} currentPrice - Current market price
 * @returns {boolean} True if order should trigger
 */
export function shouldTriggerStopLoss(advancedOrder, currentPrice) {
  // Stop-loss triggers when price falls to or below trigger price
  const current = new Decimal(currentPrice);
  const trigger = new Decimal(advancedOrder.trigger_value);
  return current.lessThanOrEqualTo(trigger);
}

/**
 * Execute a stop-loss order (create matching market order)
 * @param {string} orderId - Advanced order ID
 * @param {number} fillPrice - Price at which order was filled
 * @returns {object} Result of execution
 */
export async function executeStopLoss(orderId, fillPrice) {
  const order = await db.query(
    'SELECT * FROM advanced_orders WHERE id = $1',
    [orderId]
  );
  
  if (!order.rows.length) {
    throw new Error('Advanced order not found');
  }
  
  const advOrder = order.rows[0];
  
  // Update advanced order status
  await db.query(
    `UPDATE advanced_orders 
     SET status = $1, triggered_price = $2, triggered_at = $3, fill_price = $4, filled_quantity = $5, filled_at = $6
     WHERE id = $7`,
    ['FILLED', fillPrice, new Date(), fillPrice, advOrder.quantity, new Date(), orderId]
  );
  
  // Create ledger entry for the stop-loss execution
  const ledgerId = uuidv4();
  await db.query(
    `INSERT INTO ledger_entries 
     (id, user_id, asset_id, entry_type, quantity, price, fee, notes, advanced_order_id, created_at)
     SELECT $1, $2, a.id, $3, $4, $5, $6, $7, $8, NOW()
     FROM assets a
     JOIN markets m ON m.quote_asset_id = a.id
     WHERE m.id = $9`,
    [ledgerId, advOrder.user_id, 'TRADE', advOrder.quantity, fillPrice, 0, 'Stop-Loss Triggered', orderId, advOrder.market_id]
  );
  
  return {
    success: true,
    orderId,
    fillPrice,
    quantity: advOrder.quantity,
    timestamp: new Date()
  };
}

/**
 * Cancel a stop-loss order
 * @param {string} orderId - Advanced order ID
 * @returns {object} Canceled order
 */
export async function cancelStopLoss(orderId) {
  const result = await db.query(
    `UPDATE advanced_orders 
     SET status = $1, updated_at = NOW()
     WHERE id = $2 AND status = 'ACTIVE'
     RETURNING *`,
    ['CANCELED', orderId]
  );
  
  if (!result.rows.length) {
    throw new Error('Cannot cancel: order not found or not active');
  }
  
  return result.rows[0];
}

// ============================================================================
// TAKE-PROFIT ORDERS
// ============================================================================

/**
 * Create a take-profit order
 * @param {string} userId - User ID
 * @param {string} marketId - Market ID
 * @param {number} triggerPrice - Price at which to trigger the order
 * @param {number} quantity - Quantity to sell
 * @param {string} notes - Optional notes
 * @returns {object} Created advanced order
 */
export async function createTakeProfitOrder(userId, marketId, triggerPrice, quantity, notes = '') {
  const orderId = uuidv4();
  
  const result = await db.query(
    `INSERT INTO advanced_orders 
     (id, user_id, market_id, order_type, order_side, trigger_type, trigger_value, quantity, notes, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [orderId, userId, marketId, 'TAKE_PROFIT', 'SELL', 'PRICE', triggerPrice, quantity, notes, 'ACTIVE']
  );
  
  return result.rows[0];
}

/**
 * Check if a take-profit order should be triggered
 * @param {object} advancedOrder - Advanced order object
 * @param {number} currentPrice - Current market price
 * @returns {boolean} True if order should trigger
 */
export function shouldTriggerTakeProfit(advancedOrder, currentPrice) {
  // Take-profit triggers when price rises to or above trigger price
  const current = new Decimal(currentPrice);
  const trigger = new Decimal(advancedOrder.trigger_value);
  return current.greaterThanOrEqualTo(trigger);
}

/**
 * Execute a take-profit order
 * @param {string} orderId - Advanced order ID
 * @param {number} fillPrice - Price at which order was filled
 * @returns {object} Result of execution
 */
export async function executeTakeProfit(orderId, fillPrice) {
  const order = await db.query(
    'SELECT * FROM advanced_orders WHERE id = $1',
    [orderId]
  );
  
  if (!order.rows.length) {
    throw new Error('Advanced order not found');
  }
  
  const advOrder = order.rows[0];
  
  // Update advanced order status
  await db.query(
    `UPDATE advanced_orders 
     SET status = $1, triggered_price = $2, triggered_at = $3, fill_price = $4, filled_quantity = $5, filled_at = $6
     WHERE id = $7`,
    ['FILLED', fillPrice, new Date(), fillPrice, advOrder.quantity, new Date(), orderId]
  );
  
  // Create ledger entry for the take-profit execution
  const ledgerId = uuidv4();
  await db.query(
    `INSERT INTO ledger_entries 
     (id, user_id, asset_id, entry_type, quantity, price, fee, notes, advanced_order_id, created_at)
     SELECT $1, $2, a.id, $3, $4, $5, $6, $7, $8, NOW()
     FROM assets a
     JOIN markets m ON m.quote_asset_id = a.id
     WHERE m.id = $9`,
    [ledgerId, advOrder.user_id, 'TRADE', advOrder.quantity, fillPrice, 0, 'Take-Profit Triggered', orderId, advOrder.market_id]
  );
  
  return {
    success: true,
    orderId,
    fillPrice,
    quantity: advOrder.quantity,
    timestamp: new Date()
  };
}

/**
 * Cancel a take-profit order
 * @param {string} orderId - Advanced order ID
 * @returns {object} Canceled order
 */
export async function cancelTakeProfit(orderId) {
  const result = await db.query(
    `UPDATE advanced_orders 
     SET status = $1, updated_at = NOW()
     WHERE id = $2 AND status = 'ACTIVE'
     RETURNING *`,
    ['CANCELED', orderId]
  );
  
  if (!result.rows.length) {
    throw new Error('Cannot cancel: order not found or not active');
  }
  
  return result.rows[0];
}

// ============================================================================
// ORDER CHAINS (Link SL + TP + Trail)
// ============================================================================

/**
 * Create an order chain (link multiple advanced orders)
 * @param {string} userId - User ID
 * @param {string} parentTradeId - Parent trade ID (the position being protected)
 * @param {string} stopLossId - Optional stop-loss order ID
 * @param {string} takeProfitId - Optional take-profit order ID
 * @param {string} trailingStopId - Optional trailing stop order ID
 * @returns {object} Created order chain
 */
export async function createOrderChain(userId, parentTradeId, stopLossId = null, takeProfitId = null, trailingStopId = null) {
  const chainId = uuidv4();
  
  if (!stopLossId && !takeProfitId && !trailingStopId) {
    throw new Error('At least one order must be specified');
  }
  
  const result = await db.query(
    `INSERT INTO order_chains 
     (id, user_id, parent_trade_id, stop_loss_id, take_profit_id, trailing_stop_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [chainId, userId, parentTradeId, stopLossId, takeProfitId, trailingStopId, 'ACTIVE']
  );
  
  return result.rows[0];
}

/**
 * Get all active orders for a user
 * @param {string} userId - User ID
 * @returns {array} Array of active advanced orders
 */
export async function getActiveOrders(userId) {
  const result = await db.query(
    `SELECT 
       ao.id, ao.order_type, ao.trigger_value, ao.quantity, 
       ao.status, ao.created_at,
       m.symbol
     FROM advanced_orders ao
     JOIN markets m ON ao.market_id = m.id
     WHERE ao.user_id = $1 AND ao.status = 'ACTIVE'
     ORDER BY ao.created_at DESC`,
    [userId]
  );
  
  return result.rows;
}

/**
 * Get an advanced order by ID
 * @param {string} orderId - Advanced order ID
 * @returns {object} Advanced order
 */
export async function getAdvancedOrder(orderId) {
  const result = await db.query(
    'SELECT * FROM advanced_orders WHERE id = $1',
    [orderId]
  );
  
  if (!result.rows.length) {
    throw new Error('Advanced order not found');
  }
  
  return result.rows[0];
}

/**
 * Get order chains for a parent trade
 * @param {string} parentTradeId - Parent trade ID
 * @returns {array} Array of order chains
 */
export async function getOrderChains(parentTradeId) {
  const result = await db.query(
    `SELECT * FROM order_chains 
     WHERE parent_trade_id = $1
     ORDER BY created_at DESC`,
    [parentTradeId]
  );
  
  return result.rows;
}

/**
 * Handle cascade cancellation when one order in chain is triggered
 * @param {string} chainId - Order chain ID
 * @param {string} triggeredOrderId - Order that was triggered
 * @returns {object} Result of cascade
 */
export async function handleOrderChainTrigger(chainId, triggeredOrderId) {
  const chain = await db.query(
    'SELECT * FROM order_chains WHERE id = $1',
    [chainId]
  );
  
  if (!chain.rows.length) {
    throw new Error('Order chain not found');
  }
  
  const orderChain = chain.rows[0];
  
  // Cancel other orders in the chain
  const ordersToCancel = [];
  
  if (orderChain.stop_loss_id && orderChain.stop_loss_id !== triggeredOrderId) {
    ordersToCancel.push(orderChain.stop_loss_id);
  }
  if (orderChain.take_profit_id && orderChain.take_profit_id !== triggeredOrderId) {
    ordersToCancel.push(orderChain.take_profit_id);
  }
  if (orderChain.trailing_stop_id && orderChain.trailing_stop_id !== triggeredOrderId) {
    ordersToCancel.push(orderChain.trailing_stop_id);
  }
  
  // Cancel all other orders
  for (const orderId of ordersToCancel) {
    await db.query(
      'UPDATE advanced_orders SET status = $1, updated_at = NOW() WHERE id = $2',
      ['CANCELED', orderId]
    );
  }
  
  // Update chain status
  await db.query(
    `UPDATE order_chains 
     SET status = $1, triggered_by_order_id = $2, triggered_at = NOW(), updated_at = NOW()
     WHERE id = $3`,
    ['TRIGGERED', triggeredOrderId, chainId]
  );
  
  return {
    chainId,
    triggeredOrderId,
    canceledOrders: ordersToCancel,
    timestamp: new Date()
  };
}

/**
 * Get orders that need to be checked for triggers
 * @param {string} marketId - Market ID
 * @returns {array} Array of orders to check
 */
export async function getOrdersToCheck(marketId) {
  const result = await db.query(
    `SELECT * FROM advanced_orders 
     WHERE market_id = $1 AND status = 'ACTIVE'
     ORDER BY created_at ASC`,
    [marketId]
  );
  
  return result.rows;
}

export default {
  // Stop-Loss
  createStopLossOrder,
  shouldTriggerStopLoss,
  executeStopLoss,
  cancelStopLoss,
  
  // Take-Profit
  createTakeProfitOrder,
  shouldTriggerTakeProfit,
  executeTakeProfit,
  cancelTakeProfit,
  
  // Order Chains
  createOrderChain,
  handleOrderChainTrigger,
  
  // General
  getActiveOrders,
  getAdvancedOrder,
  getOrderChains,
  getOrdersToCheck
};
