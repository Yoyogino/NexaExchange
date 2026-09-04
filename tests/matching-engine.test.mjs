import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { matchOrder } from '../server/matching-engine.mjs';

const prisma = new PrismaClient();

describe('Order Matching Engine', () => {
  let market;
  let buyerUser;
  let sellerUser;

  beforeAll(async () => {
    // Create test users
    buyerUser = await prisma.user.create({
      data: { email: `buyer-${Date.now()}@test.com` },
    });

    sellerUser = await prisma.user.create({
      data: { email: `seller-${Date.now()}@test.com` },
    });

    // Create test market
    market = await prisma.market.create({
      data: {
        baseCurrency: 'BTC',
        quoteCurrency: 'USDT',
        symbol: 'BTC/USDT',
        isActive: true,
      },
    });

    // Initialize ledger accounts
    await prisma.ledgerAccount.create({
      data: {
        userId: buyerUser.id,
        asset: 'USDT',
        accountType: 'AVAILABLE',
      },
    });

    await prisma.ledgerAccount.create({
      data: {
        userId: buyerUser.id,
        asset: 'BTC',
        accountType: 'AVAILABLE',
      },
    });

    await prisma.ledgerAccount.create({
      data: {
        userId: sellerUser.id,
        asset: 'BTC',
        accountType: 'AVAILABLE',
      },
    });

    await prisma.ledgerAccount.create({
      data: {
        userId: sellerUser.id,
        asset: 'USDT',
        accountType: 'AVAILABLE',
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should match buy and sell limit orders at same price', async () => {
    // Create sell order: 1 BTC @ 40,000 USDT
    const sellOrder = await prisma.order.create({
      data: {
        userId: sellerUser.id,
        marketId: market.id,
        side: 'SELL',
        type: 'LIMIT',
        price: new Decimal('40000'),
        quantity: new Decimal('1'),
      },
    });

    // Create matching buy order: 1 BTC @ 40,000 USDT
    const buyOrder = await prisma.order.create({
      data: {
        userId: buyerUser.id,
        marketId: market.id,
        side: 'BUY',
        type: 'LIMIT',
        price: new Decimal('40000'),
        quantity: new Decimal('1'),
      },
    });

    // Match the buy order
    const { trades, updatedOrder } = await matchOrder(buyOrder.id);

    expect(trades).toHaveLength(1);
    expect(trades[0].price).toEqual(new Decimal('40000'));
    expect(trades[0].quantity).toEqual(new Decimal('1'));
    expect(updatedOrder.status).toBe('FILLED');
  });

  it('should calculate trading fees correctly', async () => {
    const sellOrder = await prisma.order.create({
      data: {
        userId: sellerUser.id,
        marketId: market.id,
        side: 'SELL',
        type: 'LIMIT',
        price: new Decimal('40000'),
        quantity: new Decimal('0.5'),
      },
    });

    const buyOrder = await prisma.order.create({
      data: {
        userId: buyerUser.id,
        marketId: market.id,
        side: 'BUY',
        type: 'LIMIT',
        price: new Decimal('40000'),
        quantity: new Decimal('0.5'),
      },
    });

    const { trades } = await matchOrder(buyOrder.id);

    // Fee = 0.5 BTC * 40000 USDT * 0.1% = 20 USDT
    const expectedFee = new Decimal('20');
    expect(trades[0].fee).toEqual(expectedFee);
  });

  it('should handle partial fills', async () => {
    const sellOrder = await prisma.order.create({
      data: {
        userId: sellerUser.id,
        marketId: market.id,
        side: 'SELL',
        type: 'LIMIT',
        price: new Decimal('40000'),
        quantity: new Decimal('2'),
      },
    });

    const buyOrder = await prisma.order.create({
      data: {
        userId: buyerUser.id,
        marketId: market.id,
        side: 'BUY',
        type: 'LIMIT',
        price: new Decimal('40000'),
        quantity: new Decimal('0.5'),
      },
    });

    const { updatedOrder } = await matchOrder(buyOrder.id);

    expect(updatedOrder.status).toBe('FILLED');
    expect(updatedOrder.filledAmount).toEqual(new Decimal('0.5'));

    const updatedSellOrder = await prisma.order.findUnique({
      where: { id: sellOrder.id },
    });

    expect(updatedSellOrder.status).toBe('PARTIALLY_FILLED');
    expect(updatedSellOrder.filledAmount).toEqual(new Decimal('0.5'));
  });

  it('should not match orders at incompatible prices', async () => {
    const sellOrder = await prisma.order.create({
      data: {
        userId: sellerUser.id,
        marketId: market.id,
        side: 'SELL',
        type: 'LIMIT',
        price: new Decimal('45000'), // Asking 45k
        quantity: new Decimal('1'),
      },
    });

    const buyOrder = await prisma.order.create({
      data: {
        userId: buyerUser.id,
        marketId: market.id,
        side: 'BUY',
        type: 'LIMIT',
        price: new Decimal('40000'), // Offering 40k
        quantity: new Decimal('1'),
      },
    });

    const { trades } = await matchOrder(buyOrder.id);

    // Should NOT match
    expect(trades).toHaveLength(0);

    const updatedBuyOrder = await prisma.order.findUnique({
      where: { id: buyOrder.id },
    });

    expect(updatedBuyOrder.status).toBe('PENDING');
    expect(updatedBuyOrder.filledAmount).toEqual(new Decimal('0'));
  });
});
