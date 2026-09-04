// server/trailing-stops.mjs
// Phase 5: Trailing Stop Orders Implementation

import { db } from './db.mjs';
import Decimal from 'decimal.js';

/**
 * Trailing Stops Module
 * Handles dynamic stop-loss orders that move up with price
 */

/**
 * Create a trailing stop order
 * @param {string} userId - User ID
 * @param {string} marketId - Market ID
 * @param {number} trailPercentage - Trail percentage (e.g., 5 for 5%)
 * @param {number} currentPrice - Current market price
 * @param {number} quantity - Quantity to sell
 * @param {string} notes - Optional notes
 * @returns {object} Created advanced order
 */
export async function createTrailingStop(userId, marketId, trailPercentage, currentPrice, quantity, notes = '') {
  const { v4: uuidv4 } = await import('uuid');
  const orderId = uuidv4();
  
  // Calculate initial trigger (trail_percentage below current price)
  const current = new Decimal(currentPrice);
  const trail = new Decimal(trailPercentage);
  const triggerValue = current.minus(current.times(trail.dividedBy(100))).toFixed(8);
  
  const result = await db.query(
    `INSERT INTO advanced_orders 
     (id, user_id, market_id, order_type, order_side, trigger_type, trigger_value, 
      trail_percentage, quantity, notes, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      orderId, userId, marketId, 'TRAILING_STOP', 'SELL', 'TRAIL', 
      triggerValue, trailPercentage, quantity, notes, 'ACTIVE'
    ]
  );
  
  return result.rows[0];
}

/**
 * Update trailing stop trigger based on new price
 * @param {object} trailingStop - Trailing stop order object
 * @param {number} currentPrice - Current market price
 * @returns {object|null} Updated order or null if trigger unchanged
 */
export async function updateTrailingStopTrigger(trailingStop, currentPrice) {
  const current = new Decimal(currentPrice);
  const trail = new Decimal(trailingStop.trail_percentage);
  const newTrigger = current.minus(current.times(trail.dividedBy(100))).toFixed(8);
  const oldTrigger = new Decimal(trailingStop.trigger_value);
  
  // Only update if new trigger is higher (favorable for trader)
  if (new Decimal(newTrigger).greaterThan(oldTrigger)) {
    // Update the trailing stop
    const result = await db.query(
      `UPDATE advanced_orders 
       SET trigger_value = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [newTrigger, trailingStop.id]
    );
    
    // Record the adjustment in history
    const { v4: uuidv4 } = await import('uuid');
    await db.query(
      `INSERT INTO trailing_stop_history 
       (id, advanced_order_id, previous_trigger, new_trigger, market_price, adjusted_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [uuidv4(), trailingStop.id, oldTrigger.toFixed(8), newTrigger, currentPrice]
    );
    
    return result.rows[0];
  }
  
  return null; // No update needed
}

/**
 * Check if trailing stop should be triggered
 * @param {object} trailingStop - Trailing stop order object
 * @param {number} currentPrice - Current market price
 * @returns {boolean} True if order should trigger
 */
export function shouldTriggerTrailingStop(trailingStop, currentPrice) {
  // Trigger when price falls to or below trigger value
  const current = new Decimal(currentPrice);
  const trigger = new Decimal(trailingStop.trigger_value);
  return current.lessThanOrEqualTo(trigger);
}

/**
 * Execute a trailing stop order
 * @param {string} orderId - Advanced order ID
 * @param {number} fillPrice - Price at which order was filled
 * @returns {object} Result of execution
 */
export async function executeTrailingStop(orderId, fillPrice) {
  const order = await db.query(
    'SELECT * FROM advanced_orders WHERE id = $1',
    [orderId]
  );
  
  if (!order.rows.length) {
    throw new Error('Advanced order not found');
  }
  
  const trailingStop = order.rows[0];
  
  // Update trailing stop status
  await db.query(
    `UPDATE advanced_orders 
     SET status = $1, triggered_price = $2, triggered_at = $3, 
         fill_price = $4, filled_quantity = $5, filled_at = $6
     WHERE id = $7`,
    ['FILLED', fillPrice, new Date(), fillPrice, trailingStop.quantity, new Date(), orderId]
  );
  
  // Create ledger entry for the trailing stop execution
  const { v4: uuidv4 } = await import('uuid');
  const ledgerId = uuidv4();
  await db.query(
    `INSERT INTO ledger_entries 
     (id, user_id, asset_id, entry_type, quantity, price, fee, notes, advanced_order_id, created_at)
     SELECT $1, $2, a.id, $3, $4, $5, $6, $7, $8, NOW()
     FROM assets a
     JOIN markets m ON m.quote_asset_id = a.id
     WHERE m.id = $9`,
    [ledgerId, trailingStop.user_id, 'TRADE', trailingStop.quantity, fillPrice, 0, 
     'Trailing Stop Triggered', orderId, trailingStop.market_id]
  );
  
  return {
    success: true,
    orderId,
    fillPrice,
    quantity: trailingStop.quantity,
    trailPercentage: trailingStop.trail_percentage,
    timestamp: new Date()
  };
}

/**
 * Get trailing stop history for an order
 * @param {string} orderId - Advanced order ID
 * @returns {array} Array of historical adjustments
 */
export async function getTrailingStopHistory(orderId) {
  const result = await db.query(
    `SELECT * FROM trailing_stop_history 
     WHERE advanced_order_id = $1
     ORDER BY adjusted_at DESC`,
    [orderId]
  );
  
  return result.rows;
}

/**
 * Get statistics about trailing stop performance
 * @param {string} orderId - Advanced order ID
 * @returns {object} Performance statistics
 */
export async function getTrailingStopStats(orderId) {
  const order = await db.query(
    'SELECT * FROM advanced_orders WHERE id = $1',
    [orderId]
  );
  
  if (!order.rows.length) {
    throw new Error('Advanced order not found');
  }
  
  const ts = order.rows[0];
  
  const history = await db.query(
    `SELECT * FROM trailing_stop_history 
     WHERE advanced_order_id = $1
     ORDER BY adjusted_at ASC`,
    [orderId]
  );
  
  const adjustments = history.rows;
  let highestTrigger = new Decimal(ts.trigger_value);
  let totalAdjustments = 0;
  let maxAdvance = new Decimal(0);
  
  adjustments.forEach(adj => {
    totalAdjustments++;
    const newTrigger = new Decimal(adj.new_trigger);
    const advance = newTrigger.minus(new Decimal(adj.previous_trigger));
    
    if (newTrigger.greaterThan(highestTrigger)) {
      highestTrigger = newTrigger;
    }
    if (advance.greaterThan(maxAdvance)) {
      maxAdvance = advance;
    }
  });
  
  return {
    orderId,
    orderType: ts.order_type,
    status: ts.status,
    trailPercentage: ts.trail_percentage,
    initialTrigger: ts.trigger_value,
    currentTrigger: ts.trigger_value,
    highestTrigger: highestTrigger.toFixed(8),
    quantity: ts.quantity,
    totalAdjustments,
    maxAdvance: maxAdvance.toFixed(8),
    triggeredPrice: ts.triggered_price,
    createdAt: ts.created_at,
    updatedAt: ts.updated_at
  };
}

/**
 * Cancel a trailing stop order
 * @param {string} orderId - Advanced order ID
 * @returns {object} Canceled order
 */
export async function cancelTrailingStop(orderId) {
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

/**
 * Process all trailing stops for a market
 * @param {string} marketId - Market ID
 * @param {number} currentPrice - Current market price
 * @returns {object} Results of processing
 */
export async function processMarketTrailingStops(marketId, currentPrice) {
  // Get all active trailing stops for this market
  const result = await db.query(
    `SELECT * FROM advanced_orders 
     WHERE market_id = $1 AND order_type = 'TRAILING_STOP' AND status = 'ACTIVE'
     ORDER BY created_at ASC`,
    [marketId]
  );
  
  const trailingStops = result.rows;
  const updated = [];
  const triggered = [];
  
  for (const ts of trailingStops) {
    // Try to update trigger
    const updateResult = await updateTrailingStopTrigger(ts, currentPrice);
    if (updateResult) {
      updated.push({
        orderId: ts.id,
        newTrigger: updateResult.trigger_value
      });
    }
    
    // Check if should trigger
    if (shouldTriggerTrailingStop(ts, currentPrice)) {
      await executeTrailingStop(ts.id, currentPrice);
      triggered.push({
        orderId: ts.id,
        fillPrice: currentPrice
      });
    }
  }
  
  return {
    processedCount: trailingStops.length,
    updated,
    triggered,
    timestamp: new Date()
  };
}

export default {
  createTrailingStop,
  updateTrailingStopTrigger,
  shouldTriggerTrailingStop,
  executeTrailingStop,
  getTrailingStopHistory,
  getTrailingStopStats,
  cancelTrailingStop,
  processMarketTrailingStops
};
