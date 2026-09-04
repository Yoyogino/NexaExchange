import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

const prisma = new PrismaClient();

const FEE_RATE = new Decimal('0.001'); // 0.1% trading fee

/**
 * Match a new order against existing orders
 * Returns: { trades, updatedOrder }
 */
export async function matchOrder(orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { market: true },
  });

  if (!order) throw new Error('Order not found');
  if (order.status === 'CANCELLED') throw new Error('Order is cancelled');

  const trades = [];
  let remainingQuantity = order.quantity.minus(order.filledAmount);

  // For SELL orders, match against BUY orders
  if (order.side === 'SELL') {
    const counterOrders = await prisma.order.findMany({
      where: {
        marketId: order.marketId,
        side: 'BUY',
        status: { in: ['PENDING', 'PARTIALLY_FILLED'] },
        type: 'LIMIT',
      },
      orderBy: { price: 'desc' }, // Match highest price first
    });

    for (const counterOrder of counterOrders) {
      if (remainingQuantity.lte(0)) break;

      // Check if prices match (order.price <= counterOrder.price for sell)
      if (order.type === 'LIMIT' && order.price.gt(counterOrder.price)) {
        continue; // No match possible at this price
      }

      const fillQuantity = Decimal.min(
        remainingQuantity,
        counterOrder.quantity.minus(counterOrder.filledAmount)
      );

      const tradePrice = counterOrder.price; // Maker price
      const fee = fillQuantity.times(tradePrice).times(FEE_RATE);

      const trade = await prisma.trade.create({
        data: {
          orderId: order.id,
          marketId: order.marketId,
          counterOrderId: counterOrder.id,
          price: tradePrice,
          quantity: fillQuantity,
          fee,
        },
      });

      trades.push(trade);

      // Update filled amounts
      await prisma.order.update({
        where: { id: order.id },
        data: {
          filledAmount: {
            increment: fillQuantity,
          },
          status: order.quantity.minus(order.filledAmount).minus(fillQuantity).eq(0)
            ? 'FILLED'
            : 'PARTIALLY_FILLED',
        },
      });

      await prisma.order.update({
        where: { id: counterOrder.id },
        data: {
          filledAmount: {
            increment: fillQuantity,
          },
          status: counterOrder.quantity.minus(counterOrder.filledAmount).minus(fillQuantity).eq(0)
            ? 'FILLED'
            : 'PARTIALLY_FILLED',
        },
      });

      // Update ledger: seller receives USDT
      await updateLedger(order.userId, 'USDT', fillQuantity.times(tradePrice).minus(fee), 'TRADE_SELL', trade.id);

      // Update ledger: buyer sends USDT (handled separately)
      // Update ledger: seller sends BTC
      await updateLedger(order.userId, 'BTC', fillQuantity.negated(), 'TRADE_SELL', trade.id);

      // Update ledger: buyer receives BTC
      await updateLedger(counterOrder.userId, 'BTC', fillQuantity, 'TRADE_BUY', trade.id);

      remainingQuantity = remainingQuantity.minus(fillQuantity);
    }
  }
  // For BUY orders, match against SELL orders
  else if (order.side === 'BUY') {
    const counterOrders = await prisma.order.findMany({
      where: {
        marketId: order.marketId,
        side: 'SELL',
        status: { in: ['PENDING', 'PARTIALLY_FILLED'] },
        type: 'LIMIT',
      },
      orderBy: { price: 'asc' }, // Match lowest price first
    });

    for (const counterOrder of counterOrders) {
      if (remainingQuantity.lte(0)) break;

      // Check if prices match (order.price >= counterOrder.price for buy)
      if (order.type === 'LIMIT' && order.price.lt(counterOrder.price)) {
        continue; // No match possible at this price
      }

      const fillQuantity = Decimal.min(
        remainingQuantity,
        counterOrder.quantity.minus(counterOrder.filledAmount)
      );

      const tradePrice = counterOrder.price; // Maker price
      const fee = fillQuantity.times(tradePrice).times(FEE_RATE);

      const trade = await prisma.trade.create({
        data: {
          orderId: order.id,
          marketId: order.marketId,
          counterOrderId: counterOrder.id,
          price: tradePrice,
          quantity: fillQuantity,
          fee,
        },
      });

      trades.push(trade);

      // Update filled amounts
      await prisma.order.update({
        where: { id: order.id },
        data: {
          filledAmount: {
            increment: fillQuantity,
          },
          status: order.quantity.minus(order.filledAmount).minus(fillQuantity).eq(0)
            ? 'FILLED'
            : 'PARTIALLY_FILLED',
        },
      });

      await prisma.order.update({
        where: { id: counterOrder.id },
        data: {
          filledAmount: {
            increment: fillQuantity,
          },
          status: counterOrder.quantity.minus(counterOrder.filledAmount).minus(fillQuantity).eq(0)
            ? 'FILLED'
            : 'PARTIALLY_FILLED',
        },
      });

      // Update ledger: buyer sends USDT
      await updateLedger(order.userId, 'USDT', fillQuantity.times(tradePrice).plus(fee).negated(), 'TRADE_BUY', trade.id);

      // Update ledger: buyer receives BTC
      await updateLedger(order.userId, 'BTC', fillQuantity, 'TRADE_BUY', trade.id);

      // Update ledger: seller receives USDT
      await updateLedger(counterOrder.userId, 'USDT', fillQuantity.times(tradePrice).minus(fee), 'TRADE_SELL', trade.id);

      // Update ledger: seller sends BTC
      await updateLedger(counterOrder.userId, 'BTC', fillQuantity.negated(), 'TRADE_SELL', trade.id);

      remainingQuantity = remainingQuantity.minus(fillQuantity);
    }
  }

  const updatedOrder = await prisma.order.findUnique({
    where: { id: orderId },
  });

  return { trades, updatedOrder };
}

/**
 * Update ledger account atomically
 */
async function updateLedger(userId, asset, amount, reason, relatedId) {
  const groupId = `trade-${relatedId}`;
  
  // Debit from AVAILABLE
  await prisma.ledgerEntry.create({
    data: {
      groupId,
      ledgerAccount: {
        connectOrCreate: {
          where: {
            userId_asset_accountType: {
              userId,
              asset,
              accountType: 'AVAILABLE',
            },
          },
          create: {
            userId,
            asset,
            accountType: 'AVAILABLE',
          },
        },
      },
      direction: amount.gt(0) ? 'CREDIT' : 'DEBIT',
      amount: amount.abs(),
      reason,
      relatedType: 'Trade',
      relatedId,
    },
  });
}

export default { matchOrder };
