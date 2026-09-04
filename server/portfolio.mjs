import { prisma } from './db.mjs';
import Decimal from 'decimal.js';

/**
 * Calculate user portfolio value
 * @param {string} userId - User ID
 * @param {Object} prices - Current prices {BTC: 40000, USDT: 1}
 * @returns {Object} {totalUSD, assets, breakdown}
 */
async function getPortfolioValue(userId, prices = {}) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { wallets: true },
  });

  if (!user) throw new Error('User not found');

  // Default prices if not provided
  const defaultPrices = {
    BTC: prices.BTC || 40000,
    ETH: prices.ETH || 2000,
    USDT: 1,
  };

  let totalUSD = 0;
  const breakdown = {};

  for (const wallet of user.wallets) {
    const balance = new Decimal(wallet.availableBalance);
    const price = defaultPrices[wallet.asset] || 0;
    const usdValue = balance.times(price);

    breakdown[wallet.asset] = {
      balance: balance.toString(),
      price,
      usdValue: usdValue.toFixed(2),
    };

    totalUSD += parseFloat(usdValue);
  }

  return {
    userId,
    totalUSD: totalUSD.toFixed(2),
    wallets: user.wallets.length,
    breakdown,
  };
}

/**
 * Calculate asset allocation percentage
 * @param {Object} breakdown - Portfolio breakdown from getPortfolioValue
 * @returns {Object} {asset: percentage}
 */
function getAllocationPercentage(breakdown) {
  const total = Object.values(breakdown).reduce(
    (sum, b) => sum + parseFloat(b.usdValue),
    0
  );

  if (total === 0) return {};

  const allocation = {};
  for (const [asset, data] of Object.entries(breakdown)) {
    allocation[asset] = ((parseFloat(data.usdValue) / total) * 100).toFixed(2);
  }

  return allocation;
}

/**
 * Calculate user P&L (Profit & Loss)
 * @param {string} userId - User ID
 * @returns {Object} {totalPnL, openTrades, closedTrades, winRate}
 */
async function getUserPnL(userId) {
  // Get all closed trades (orders with status FILLED)
  const filledOrders = await prisma.order.findMany({
    where: {
      userId,
      status: 'FILLED',
    },
    include: {
      trades: true,
      market: true,
    },
  });

  let totalPnL = 0;
  let winTrades = 0;
  let lossTrades = 0;

  for (const order of filledOrders) {
    for (const trade of order.trades) {
      const orderPrice = new Decimal(order.price || 0);
      const tradePrice = new Decimal(trade.price);
      const tradeQty = new Decimal(trade.quantity);

      if (order.side === 'BUY') {
        // For buys: profit if sold higher (doesn't apply yet unless matched with sell)
        continue;
      } else {
        // For sells: profit if sold higher than avg buy price
        const fee = tradeQty.times(tradePrice).times(0.001);
        const revenue = tradeQty.times(tradePrice).minus(fee);
        // Would need matching buy order to calc true P&L
      }
    }
  }

  // Get open orders (potential P&L)
  const openOrders = await prisma.order.findMany({
    where: {
      userId,
      status: { in: ['OPEN', 'PARTIALLY_FILLED'] },
    },
    include: { market: true },
  });

  return {
    userId,
    totalPnL: parseFloat(totalPnL.toFixed(2)),
    filledOrders: filledOrders.length,
    openOrders: openOrders.length,
    winRate: filledOrders.length > 0 ? (winTrades / filledOrders.length * 100).toFixed(2) : 0,
  };
}

/**
 * Get trading history with filters
 * @param {string} userId - User ID
 * @param {Object} filters - {symbol, side, status, limit}
 * @returns {Array} Sorted trading history
 */
async function getTradingHistory(userId, filters = {}) {
  const {
    symbol,
    side,
    status,
    limit = 50,
  } = filters;

  const where = { userId };

  if (symbol) {
    where.market = { symbol };
  }

  if (side) {
    where.side = side;
  }

  if (status) {
    where.status = status;
  }

  const orders = await prisma.order.findMany({
    where,
    include: {
      market: true,
      trades: true,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return orders.map(order => ({
    orderId: order.id,
    symbol: order.market.symbol,
    side: order.side,
    type: order.type,
    price: order.price,
    quantity: order.quantity,
    filledAmount: order.filledAmount,
    status: order.status,
    trades: order.trades.length,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  }));
}

/**
 * Calculate trading performance metrics
 * @param {string} userId - User ID
 * @returns {Object} Daily/Weekly/Monthly performance
 */
async function getTradingPerformance(userId) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());

  const dailyTrades = await prisma.trade.count({
    where: {
      order: { userId },
      createdAt: { gte: today },
    },
  });

  const weeklyTrades = await prisma.trade.count({
    where: {
      order: { userId },
      createdAt: { gte: weekAgo },
    },
  });

  const monthlyTrades = await prisma.trade.count({
    where: {
      order: { userId },
      createdAt: { gte: monthAgo },
    },
  });

  const totalTrades = await prisma.trade.count({
    where: { order: { userId } },
  });

  const totalVolume = await prisma.trade.aggregate({
    where: { order: { userId } },
    _sum: { quantity: true },
  });

  const totalFees = await prisma.trade.aggregate({
    where: { order: { userId } },
    _sum: { fee: true },
  });

  return {
    userId,
    dailyTrades,
    weeklyTrades,
    monthlyTrades,
    totalTrades,
    totalVolume: parseFloat(totalVolume._sum?.quantity || 0).toFixed(8),
    totalFees: parseFloat(totalFees._sum?.fee || 0).toFixed(2),
    averageTradeSize: totalTrades > 0 
      ? (parseFloat(totalVolume._sum?.quantity || 0) / totalTrades).toFixed(8)
      : '0',
  };
}

/**
 * Get market statistics for a symbol
 * @param {string} symbol - Market symbol
 * @returns {Object} Market stats (volume, trades, price)
 */
async function getMarketStats(symbol) {
  const market = await prisma.market.findUnique({
    where: { symbol },
  });

  if (!market) throw new Error('Market not found');

  const trades = await prisma.trade.findMany({
    where: { marketId: market.id },
    select: { price: true, quantity: true, fee: true },
  });

  if (trades.length === 0) {
    return {
      symbol,
      trades: 0,
      volume: 0,
      fees: 0,
      priceHigh: 0,
      priceLow: 0,
      lastPrice: 0,
    };
  }

  const prices = trades.map(t => parseFloat(t.price));
  const volumes = trades.map(t => parseFloat(t.quantity));
  const fees = trades.map(t => parseFloat(t.fee || 0));

  return {
    symbol,
    trades: trades.length,
    volume: volumes.reduce((a, b) => a + b, 0).toFixed(8),
    fees: fees.reduce((a, b) => a + b, 0).toFixed(2),
    priceHigh: Math.max(...prices).toFixed(2),
    priceLow: Math.min(...prices).toFixed(2),
    lastPrice: prices[prices.length - 1].toFixed(2),
    avgPrice: (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2),
  };
}

export {
  getPortfolioValue,
  getAllocationPercentage,
  getUserPnL,
  getTradingHistory,
  getTradingPerformance,
  getMarketStats,
};
