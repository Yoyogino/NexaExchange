// server/monitor-service.mjs
// Phase 5: Background service to monitor and execute advanced orders

import { db } from './db.mjs';
import * as advOrders from './advanced-orders.mjs';
import * as trailingStops from './trailing-stops.mjs';
import Decimal from 'decimal.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

/**
 * Monitor Service
 * Polls database every second for orders that should be triggered
 * Handles stop-loss, take-profit, and trailing stop execution
 */

class OrderMonitorService {
  constructor(options = {}) {
    this.pollInterval = options.pollInterval || 1000; // 1 second
    this.maxConcurrentChecks = options.maxConcurrentChecks || 50;
    this.isRunning = false;
    this.lastPollTime = null;
    this.processedCount = 0;
    this.triggeredCount = 0;
    this.checkMarkets = options.checkMarkets || [];
  }

  /**
   * Start the monitor service
   */
  start() {
    if (this.isRunning) {
      logger.warn('Monitor service already running');
      return;
    }

    this.isRunning = true;
    logger.info('Order monitor service started');

    // Start polling
    this.poll();
  }

  /**
   * Stop the monitor service
   */
  stop() {
    this.isRunning = false;
    logger.info('Order monitor service stopped');
  }

  /**
   * Main polling loop
   */
  async poll() {
    while (this.isRunning) {
      try {
        this.lastPollTime = new Date();
        await this.checkAllOrders();
      } catch (err) {
        logger.error({ err }, 'Error in monitor poll cycle');
      }

      // Wait for next poll interval
      await new Promise(resolve => setTimeout(resolve, this.pollInterval));
    }
  }

  /**
   * Check all active orders for triggers
   */
  async checkAllOrders() {
    try {
      // Get all active orders
      const result = await db.query(
        `SELECT ao.*, m.id as market_id, m.symbol 
         FROM advanced_orders ao
         JOIN markets m ON ao.market_id = m.id
         WHERE ao.status = 'ACTIVE'
         ORDER BY ao.created_at ASC
         LIMIT $1`,
        [this.maxConcurrentChecks]
      );

      const orders = result.rows;
      this.processedCount += orders.length;

      // Check each order
      for (const order of orders) {
        try {
          await this.checkOrder(order);
        } catch (err) {
          logger.error(
            { orderId: order.id, err },
            'Error checking order'
          );
        }
      }

      // Log stats every 10 seconds
      if (Math.random() < 0.1) {
        logger.debug(
          { processed: this.processedCount, triggered: this.triggeredCount },
          'Monitor service stats'
        );
      }
    } catch (err) {
      logger.error({ err }, 'Error in checkAllOrders');
    }
  }

  /**
   * Check if a single order should be triggered
   */
  async checkOrder(order) {
    // Get current market price
    const price = await this.getCurrentMarketPrice(order.market_id);
    if (!price) {
      return; // Price data unavailable
    }

    let shouldTrigger = false;
    let triggerFunc = null;

    // Determine which type of order and check trigger condition
    switch (order.order_type) {
      case 'STOP_LOSS':
        shouldTrigger = advOrders.shouldTriggerStopLoss(order, price);
        triggerFunc = () => advOrders.executeStopLoss(order.id, price);
        break;

      case 'TAKE_PROFIT':
        shouldTrigger = advOrders.shouldTriggerTakeProfit(order, price);
        triggerFunc = () => advOrders.executeTakeProfit(order.id, price);
        break;

      case 'TRAILING_STOP':
        // Update trailing stop trigger first
        await trailingStops.updateTrailingStopTrigger(order, price);

        // Check if should trigger
        shouldTrigger = trailingStops.shouldTriggerTrailingStop(order, price);
        triggerFunc = () => trailingStops.executeTrailingStop(order.id, price);
        break;

      default:
        logger.warn({ orderType: order.order_type }, 'Unknown order type');
        return;
    }

    // Execute if triggered
    if (shouldTrigger) {
      try {
        await triggerFunc();
        this.triggeredCount++;

        logger.info(
          {
            orderId: order.id,
            orderType: order.order_type,
            symbol: order.symbol,
            triggerPrice: order.trigger_value,
            fillPrice: price
          },
          'Order triggered and executed'
        );

        // Handle order chain cascade if applicable
        const chains = await db.query(
          `SELECT * FROM order_chains 
           WHERE (stop_loss_id = $1 OR take_profit_id = $1 OR trailing_stop_id = $1)
           AND status = 'ACTIVE'`,
          [order.id]
        );

        for (const chain of chains.rows) {
          try {
            await advOrders.handleOrderChainTrigger(chain.id, order.id);
            logger.info(
              { chainId: chain.id, triggeredOrderId: order.id },
              'Order chain cascade executed'
            );
          } catch (err) {
            logger.error(
              { chainId: chain.id, err },
              'Error handling order chain cascade'
            );
          }
        }
      } catch (err) {
        logger.error(
          { orderId: order.id, err },
          'Error executing triggered order'
        );
      }
    }
  }

  /**
   * Get current market price
   * Uses cache if available, falls back to database
   */
  async getCurrentMarketPrice(marketId) {
    try {
      // Try to get latest trade price
      const result = await db.query(
        `SELECT price FROM trades 
         WHERE market_id = $1 AND status = 'FILLED'
         ORDER BY created_at DESC
         LIMIT 1`,
        [marketId]
      );

      if (result.rows.length > 0) {
        return new Decimal(result.rows[0].price);
      }

      return null;
    } catch (err) {
      logger.error({ marketId, err }, 'Error getting market price');
      return null;
    }
  }

  /**
   * Get monitor service status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      pollInterval: this.pollInterval,
      maxConcurrentChecks: this.maxConcurrentChecks,
      lastPollTime: this.lastPollTime,
      processedCount: this.processedCount,
      triggeredCount: this.triggeredCount,
      uptime: this.isRunning ? Date.now() - this.startTime : null
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.processedCount = 0;
    this.triggeredCount = 0;
    this.startTime = Date.now();
  }
}

// Export singleton instance
let monitorInstance = null;

/**
 * Get or create monitor service instance
 */
export function getMonitorService(options = {}) {
  if (!monitorInstance) {
    monitorInstance = new OrderMonitorService(options);
  }
  return monitorInstance;
}

/**
 * Start monitoring orders
 */
export function startMonitoring(options = {}) {
  const monitor = getMonitorService(options);
  if (!monitor.isRunning) {
    monitor.start();
  }
  return monitor;
}

/**
 * Stop monitoring orders
 */
export function stopMonitoring() {
  if (monitorInstance) {
    monitorInstance.stop();
  }
}

/**
 * Get monitor status
 */
export function getMonitorStatus() {
  if (!monitorInstance) {
    return {
      isRunning: false,
      message: 'Monitor service not initialized'
    };
  }
  return monitorInstance.getStatus();
}

export default OrderMonitorService;
