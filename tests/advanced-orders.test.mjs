// tests/advanced-orders.test.mjs
// Test suite for Phase 5: Stop-Loss, Take-Profit, and Order Chains

import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import * as advOrders from '../server/advanced-orders.mjs';
import { db } from '../server/db.mjs';
import { v4 as uuidv4 } from 'uuid';

describe('Advanced Orders - Phase 5', () => {
  let userId, marketId, marketId2;
  let testTradeId;
  
  // Setup: Create test data
  before(async () => {
    // Create test user
    const userRes = await db.query(
      `INSERT INTO users (id, email, role) VALUES ($1, $2, $3) RETURNING id`,
      [uuidv4(), `test-adv-${Date.now()}@example.com`, 'TRADER']
    );
    userId = userRes.rows[0].id;
    
    // Create test assets
    const btcRes = await db.query(
      `INSERT INTO assets (id, symbol, name) VALUES ($1, 'BTC', 'Bitcoin') RETURNING id`
    );
    const btcId = btcRes.rows[0].id;
    
    const usdtRes = await db.query(
      `INSERT INTO assets (id, symbol, name) VALUES ($1, 'USDT', 'Tether') RETURNING id`
    );
    const usdtId = usdtRes.rows[0].id;
    
    // Create test market BTC/USDT
    const marketRes = await db.query(
      `INSERT INTO markets (id, base_asset_id, quote_asset_id, symbol) 
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [uuidv4(), btcId, usdtId, 'BTC/USDT']
    );
    marketId = marketRes.rows[0].id;
    
    // Create another market for testing
    const ethRes = await db.query(
      `INSERT INTO assets (id, symbol, name) VALUES ($1, 'ETH', 'Ethereum') RETURNING id`
    );
    const ethId = ethRes.rows[0].id;
    
    const market2Res = await db.query(
      `INSERT INTO markets (id, base_asset_id, quote_asset_id, symbol) 
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [uuidv4(), ethId, usdtId, 'ETH/USDT']
    );
    marketId2 = market2Res.rows[0].id;
    
    // Create test trade
    const tradeRes = await db.query(
      `INSERT INTO trades (id, user_id, market_id, side, quantity, price, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [uuidv4(), userId, marketId, 'BUY', '1.5', '45000', 'FILLED']
    );
    testTradeId = tradeRes.rows[0].id;
  });
  
  // Cleanup
  after(async () => {
    await db.query('DELETE FROM users WHERE id = $1', [userId]);
  });
  
  // ========================================================================
  // STOP-LOSS TESTS
  // ========================================================================
  
  describe('Stop-Loss Orders', () => {
    let stopLossOrderId;
    
    it('should create a stop-loss order', async () => {
      const order = await advOrders.createStopLossOrder(
        userId,
        marketId,
        '40000',  // Trigger at $40k
        '1.5',    // Sell 1.5 BTC
        'Protective stop-loss'
      );
      
      expect(order).to.exist;
      expect(order.order_type).to.equal('STOP_LOSS');
      expect(order.status).to.equal('ACTIVE');
      expect(order.trigger_value).to.equal('40000');
      
      stopLossOrderId = order.id;
    });
    
    it('should detect stop-loss trigger at exact trigger price', async () => {
      const order = await advOrders.getAdvancedOrder(stopLossOrderId);
      const shouldTrigger = advOrders.shouldTriggerStopLoss(order, 40000);
      expect(shouldTrigger).to.be.true;
    });
    
    it('should detect stop-loss trigger below trigger price', async () => {
      const order = await advOrders.getAdvancedOrder(stopLossOrderId);
      const shouldTrigger = advOrders.shouldTriggerStopLoss(order, 39500);
      expect(shouldTrigger).to.be.true;
    });
    
    it('should not trigger stop-loss above trigger price', async () => {
      const order = await advOrders.getAdvancedOrder(stopLossOrderId);
      const shouldTrigger = advOrders.shouldTriggerStopLoss(order, 42000);
      expect(shouldTrigger).to.be.false;
    });
    
    it('should execute stop-loss order', async () => {
      const result = await advOrders.executeStopLoss(stopLossOrderId, '39900');
      
      expect(result.success).to.be.true;
      expect(result.fillPrice).to.equal('39900');
      expect(result.quantity).to.equal('1.5');
      
      const updated = await advOrders.getAdvancedOrder(stopLossOrderId);
      expect(updated.status).to.equal('FILLED');
      expect(updated.filled_quantity).to.equal('1.5');
    });
    
    it('should cancel stop-loss order', async () => {
      // Create new order for cancellation test
      const order = await advOrders.createStopLossOrder(
        userId,
        marketId,
        '38000',
        '1.0'
      );
      
      const canceled = await advOrders.cancelStopLoss(order.id);
      expect(canceled.status).to.equal('CANCELED');
    });
  });
  
  // ========================================================================
  // TAKE-PROFIT TESTS
  // ========================================================================
  
  describe('Take-Profit Orders', () => {
    let takeProfitOrderId;
    
    it('should create a take-profit order', async () => {
      const order = await advOrders.createTakeProfitOrder(
        userId,
        marketId,
        '50000',  // Trigger at $50k
        '1.5',    // Sell 1.5 BTC
        'Take-profit at target'
      );
      
      expect(order).to.exist;
      expect(order.order_type).to.equal('TAKE_PROFIT');
      expect(order.status).to.equal('ACTIVE');
      expect(order.trigger_value).to.equal('50000');
      
      takeProfitOrderId = order.id;
    });
    
    it('should detect take-profit trigger at exact trigger price', async () => {
      const order = await advOrders.getAdvancedOrder(takeProfitOrderId);
      const shouldTrigger = advOrders.shouldTriggerTakeProfit(order, 50000);
      expect(shouldTrigger).to.be.true;
    });
    
    it('should detect take-profit trigger above trigger price', async () => {
      const order = await advOrders.getAdvancedOrder(takeProfitOrderId);
      const shouldTrigger = advOrders.shouldTriggerTakeProfit(order, 51000);
      expect(shouldTrigger).to.be.true;
    });
    
    it('should not trigger take-profit below trigger price', async () => {
      const order = await advOrders.getAdvancedOrder(takeProfitOrderId);
      const shouldTrigger = advOrders.shouldTriggerTakeProfit(order, 48000);
      expect(shouldTrigger).to.be.false;
    });
    
    it('should execute take-profit order', async () => {
      const result = await advOrders.executeTakeProfit(takeProfitOrderId, '50100');
      
      expect(result.success).to.be.true;
      expect(result.fillPrice).to.equal('50100');
      expect(result.quantity).to.equal('1.5');
      
      const updated = await advOrders.getAdvancedOrder(takeProfitOrderId);
      expect(updated.status).to.equal('FILLED');
    });
    
    it('should cancel take-profit order', async () => {
      const order = await advOrders.createTakeProfitOrder(
        userId,
        marketId,
        '55000',
        '0.5'
      );
      
      const canceled = await advOrders.cancelTakeProfit(order.id);
      expect(canceled.status).to.equal('CANCELED');
    });
  });
  
  // ========================================================================
  // ORDER CHAIN TESTS
  // ========================================================================
  
  describe('Order Chains', () => {
    let slOrderId, tpOrderId, chainId;
    
    it('should create stop-loss and take-profit for chain', async () => {
      const sl = await advOrders.createStopLossOrder(userId, marketId, '42000', '1.5');
      const tp = await advOrders.createTakeProfitOrder(userId, marketId, '48000', '1.5');
      
      slOrderId = sl.id;
      tpOrderId = tp.id;
      
      expect(slOrderId).to.exist;
      expect(tpOrderId).to.exist;
    });
    
    it('should create order chain linking SL + TP', async () => {
      const chain = await advOrders.createOrderChain(
        userId,
        testTradeId,
        slOrderId,
        tpOrderId,
        null  // No trailing stop
      );
      
      expect(chain).to.exist;
      expect(chain.status).to.equal('ACTIVE');
      expect(chain.stop_loss_id).to.equal(slOrderId);
      expect(chain.take_profit_id).to.equal(tpOrderId);
      
      chainId = chain.id;
    });
    
    it('should get order chains for trade', async () => {
      const chains = await advOrders.getOrderChains(testTradeId);
      
      expect(chains).to.be.an('array');
      expect(chains.length).to.be.greaterThan(0);
      expect(chains[0].id).to.equal(chainId);
    });
    
    it('should handle order chain trigger cascade', async () => {
      const result = await advOrders.handleOrderChainTrigger(chainId, slOrderId);
      
      expect(result.chainId).to.equal(chainId);
      expect(result.triggeredOrderId).to.equal(slOrderId);
      expect(result.canceledOrders).to.include(tpOrderId);
      
      // Verify TP order is now canceled
      const tpOrder = await advOrders.getAdvancedOrder(tpOrderId);
      expect(tpOrder.status).to.equal('CANCELED');
    });
    
    it('should reject chain with no orders', async () => {
      try {
        await advOrders.createOrderChain(userId, testTradeId);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).to.include('At least one order must be specified');
      }
    });
  });
  
  // ========================================================================
  // GENERAL FUNCTIONALITY TESTS
  // ========================================================================
  
  describe('General Functionality', () => {
    it('should get active orders for user', async () => {
      // Create a few active orders
      await advOrders.createStopLossOrder(userId, marketId, '41000', '0.5');
      await advOrders.createTakeProfitOrder(userId, marketId2, '3000', '10');
      
      const activeOrders = await advOrders.getActiveOrders(userId);
      
      expect(activeOrders).to.be.an('array');
      expect(activeOrders.length).to.be.greaterThan(0);
      activeOrders.forEach(order => {
        expect(order.status).to.equal('ACTIVE');
      });
    });
    
    it('should get orders to check for market', async () => {
      const orders = await advOrders.getOrdersToCheck(marketId);
      
      expect(orders).to.be.an('array');
      orders.forEach(order => {
        expect(order.market_id).to.equal(marketId);
        expect(order.status).to.equal('ACTIVE');
      });
    });
  });
});
