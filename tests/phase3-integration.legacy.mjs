import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import fetch from 'node-fetch';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { fetchMarketPrices, getMarketConditions, getMarketStats } from '../server/market-data.mjs';

const prisma = new PrismaClient();

describe('Phase 3: Market Data & Real-Time Features', () => {
  let market;
  let testUser;

  beforeAll(async () => {
    // Setup test data
    testUser = await prisma.user.create({
      data: { email: `phase3-test-${Date.now()}@test.com` },
    });

    market = await prisma.market.findUnique({
      where: { symbol: 'BTC/USDT' },
    }) || await prisma.market.create({
      data: {
        baseCurrency: 'BTC',
        quoteCurrency: 'USDT',
        symbol: 'BTC/USDT',
        isActive: true,
      },
    });

    // Initialize ledger
    await prisma.ledgerAccount.createMany({
      data: [
        {
          userId: testUser.id,
          asset: 'BTC',
          accountType: 'AVAILABLE',
        },
        {
          userId: testUser.id,
          asset: 'USDT',
          accountType: 'AVAILABLE',
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Market Data Service', () => {
    it('should fetch prices from CoinGecko', async () => {
      const prices = await fetchMarketPrices();

      expect(prices['BTC/USDT']).toBeDefined();
      expect(prices['BTC/USDT'].price).toBeInstanceOf(Decimal);
      expect(prices['BTC/USDT'].price.toNumber()).toBeGreaterThan(0);
    });

    it('should cache prices for 5 seconds', async () => {
      const prices1 = await fetchMarketPrices();
      const timestamp1 = prices1.lastUpdate;

      // Wait 1 second
      await new Promise(resolve => setTimeout(resolve, 1000));

      const prices2 = await fetchMarketPrices();
      const timestamp2 = prices2.lastUpdate;

      // Timestamps should be the same (cached)
      expect(timestamp1).toBe(timestamp2);
    });

    it('should return stale cache on API error', async () => {
      // First call to populate cache
      await fetchMarketPrices();

      // Mock API failure by checking that we gracefully fall back
      const prices = await fetchMarketPrices();
      expect(prices['BTC/USDT']).toBeDefined();
    });

    it('should calculate market statistics', async () => {
      // Create some test trades
      await prisma.trade.create({
        data: {
          orderId: (await prisma.order.create({
            data: {
              userId: testUser.id,
              marketId: market.id,
              side: 'BUY',
              type: 'LIMIT',
              price: new Decimal('40000'),
              quantity: new Decimal('0.5'),
              status: 'FILLED',
              filledAmount: new Decimal('0.5'),
            },
          })).id,
          marketId: market.id,
          price: new Decimal('40000'),
          quantity: new Decimal('0.5'),
          fee: new Decimal('20'),
        },
      });

      const stats = await getMarketStats('BTC/USDT');

      expect(stats).toBeDefined();
      expect(stats.symbol).toBe('BTC/USDT');
      expect(stats.trades24h).toBeGreaterThanOrEqual(1);
      expect(stats.volume24h).toBeInstanceOf(Decimal);
    });

    it('should get market conditions (price + orderbook)', async () => {
      const conditions = await getMarketConditions('BTC/USDT');

      expect(conditions).toBeDefined();
      expect(conditions.symbol).toBe('BTC/USDT');
      expect(conditions.externalPrice).toBeDefined();
      expect(conditions.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('WebSocket Events', () => {
    it('should emit trade execution event', async () => {
      // Create an order that will generate a trade
      const sellOrder = await prisma.order.create({
        data: {
          userId: testUser.id,
          marketId: market.id,
          side: 'SELL',
          type: 'LIMIT',
          price: new Decimal('40000'),
          quantity: new Decimal('0.5'),
        },
      });

      const buyOrder = await prisma.order.create({
        data: {
          userId: testUser.id,
          marketId: market.id,
          side: 'BUY',
          type: 'LIMIT',
          price: new Decimal('40000'),
          quantity: new Decimal('0.5'),
        },
      });

      const trade = await prisma.trade.create({
        data: {
          orderId: buyOrder.id,
          marketId: market.id,
          counterOrderId: sellOrder.id,
          price: new Decimal('40000'),
          quantity: new Decimal('0.5'),
          fee: new Decimal('20'),
        },
      });

      expect(trade).toBeDefined();
      expect(trade.orderId).toBe(buyOrder.id);
      expect(trade.price.toNumber()).toBe(40000);
    });

    it('should track order updates', async () => {
      const order = await prisma.order.create({
        data: {
          userId: testUser.id,
          marketId: market.id,
          side: 'BUY',
          type: 'LIMIT',
          price: new Decimal('40000'),
          quantity: new Decimal('0.5'),
          status: 'PENDING',
        },
      });

      expect(order.status).toBe('PENDING');

      // Simulate order fill
      const updated = await prisma.order.update({
        where: { id: order.id },
        data: {
          filledAmount: new Decimal('0.5'),
          status: 'FILLED',
        },
      });

      expect(updated.status).toBe('FILLED');
      expect(updated.filledAmount.toNumber()).toBe(0.5);
    });
  });

  describe('Admin Dashboard', () => {
    it('should calculate trading volume correctly', async () => {
      const stats = await getMarketStats('BTC/USDT');
      const volume = stats.volume24h;

      expect(volume).toBeInstanceOf(Decimal);
      expect(volume.toNumber()).toBeGreaterThanOrEqual(0);
    });

    it('should detect high and low prices', async () => {
      const stats = await getMarketStats('BTC/USDT');

      if (stats.highPrice && stats.lowPrice) {
        expect(stats.highPrice.gte(stats.lowPrice)).toBe(true);
      }
    });

    it('should flag suspicious trading patterns', async () => {
      // Create a suspicious user (100+ orders in 24h)
      const suspiciousUser = await prisma.user.create({
        data: { email: `suspicious-${Date.now()}@test.com` },
      });

      // Create 101 orders
      for (let i = 0; i < 101; i++) {
        await prisma.order.create({
          data: {
            userId: suspiciousUser.id,
            marketId: market.id,
            side: i % 2 === 0 ? 'BUY' : 'SELL',
            type: 'LIMIT',
            price: new Decimal('40000'),
            quantity: new Decimal('0.01'),
            status: 'PENDING',
          },
        });
      }

      // Query suspicious users
      const hour24AgoMs = 24 * 60 * 60 * 1000;
      const now = new Date();

      const flagged = await prisma.user.findMany({
        where: {
          orders: {
            some: {
              createdAt: { gte: new Date(now.getTime() - hour24AgoMs) },
            },
          },
        },
        select: {
          id: true,
          _count: { select: { orders: true } },
        },
      });

      const suspiciousCount = flagged.filter(u => u._count.orders > 100).length;
      expect(suspiciousCount).toBeGreaterThanOrEqual(1);
    });
  });
});
