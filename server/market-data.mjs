import fetch from 'node-fetch';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

const prisma = new PrismaClient();

const COINGECKO_API = 'https://api.coingecko.com/api/v3';

// Cache to avoid excessive API calls
const priceCache = {
  'BTC/USDT': null,
  'ETH/USDT': null,
  lastUpdate: null,
};

const CACHE_TTL_MS = 5000; // 5 second cache

/**
 * Fetch current market prices from CoinGecko
 */
export async function fetchMarketPrices() {
  try {
    // Check cache
    if (priceCache.lastUpdate && Date.now() - priceCache.lastUpdate < CACHE_TTL_MS) {
      return priceCache;
    }

    // Fetch from CoinGecko
    const response = await fetch(
      `${COINGECKO_API}/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_market_cap=true`,
      { timeout: 5000 }
    );

    if (!response.ok) {
      console.error(`CoinGecko API error: ${response.status}`);
      return priceCache; // Return cached data on error
    }

    const data = await response.json();

    // Update cache
    priceCache['BTC/USDT'] = {
      price: new Decimal(data.bitcoin.usd),
      marketCap: data.bitcoin.usd_market_cap,
      timestamp: new Date(),
    };

    priceCache['ETH/USDT'] = {
      price: new Decimal(data.ethereum.usd),
      marketCap: data.ethereum.usd_market_cap,
      timestamp: new Date(),
    };

    priceCache.lastUpdate = Date.now();

    return priceCache;
  } catch (error) {
    console.error('Market data fetch error:', error.message);
    return priceCache; // Return cached data on error
  }
}

/**
 * Get last trade price for a market (from orderbook)
 */
export async function getLastTradePrice(marketSymbol) {
  const market = await prisma.market.findUnique({
    where: { symbol: marketSymbol },
  });

  if (!market) return null;

  // Get last trade for this market
  const lastTrade = await prisma.trade.findFirst({
    where: { marketId: market.id },
    orderBy: { createdAt: 'desc' },
  });

  return lastTrade?.price || null;
}

/**
 * Get market statistics
 */
export async function getMarketStats(marketSymbol) {
  const market = await prisma.market.findUnique({
    where: { symbol: marketSymbol },
  });

  if (!market) return null;

  // Get 24h stats
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [trades, orders] = await Promise.all([
    prisma.trade.findMany({
      where: {
        marketId: market.id,
        createdAt: { gte: twentyFourHoursAgo },
      },
    }),
    prisma.order.findMany({
      where: {
        marketId: market.id,
        createdAt: { gte: twentyFourHoursAgo },
      },
    }),
  ]);

  // Calculate stats
  const volumes = trades.map(t => t.quantity.times(t.price));
  const totalVolume = volumes.reduce((sum, v) => sum.plus(v), new Decimal(0));

  const prices = trades.map(t => t.price);
  const highPrice = prices.length > 0 ? prices.reduce((max, p) => p.gt(max) ? p : max) : null;
  const lowPrice = prices.length > 0 ? prices.reduce((min, p) => p.lt(min) ? p : min) : null;
  const lastPrice = prices.length > 0 ? prices[prices.length - 1] : null;

  return {
    symbol: market.symbol,
    lastPrice,
    highPrice,
    lowPrice,
    volume24h: totalVolume,
    trades24h: trades.length,
    orders24h: orders.length,
    timestamp: new Date(),
  };
}

/**
 * Get current market conditions (price + orderbook stats)
 */
export async function getMarketConditions(marketSymbol) {
  const [externalPrice, lastTradePrice, stats] = await Promise.all([
    fetchMarketPrices().then(prices => prices[marketSymbol]),
    getLastTradePrice(marketSymbol),
    getMarketStats(marketSymbol),
  ]);

  const market = await prisma.market.findUnique({
    where: { symbol: marketSymbol },
  });

  if (!market) return null;

  // Get current orderbook
  const [buyOrders, sellOrders] = await Promise.all([
    prisma.order.findMany({
      where: {
        marketId: market.id,
        side: 'BUY',
        status: { in: ['PENDING', 'PARTIALLY_FILLED'] },
      },
      orderBy: { price: 'desc' },
      take: 1,
    }),
    prisma.order.findMany({
      where: {
        marketId: market.id,
        side: 'SELL',
        status: { in: ['PENDING', 'PARTIALLY_FILLED'] },
      },
      orderBy: { price: 'asc' },
      take: 1,
    }),
  ]);

  const bestBid = buyOrders.length > 0 ? buyOrders[0].price : null;
  const bestAsk = sellOrders.length > 0 ? sellOrders[0].price : null;
  const spread = bestBid && bestAsk ? bestAsk.minus(bestBid) : null;

  return {
    symbol: marketSymbol,
    externalPrice: externalPrice?.price || lastTradePrice || null,
    bestBid,
    bestAsk,
    spread,
    spreadPercentage: spread && bestMid ? spread.div(bestMid).times(100) : null,
    lastTradePrice,
    stats,
    timestamp: new Date(),
  };
}

/**
 * Start market data scheduler (fetches prices every N seconds)
 */
let schedulerInterval = null;

export function startMarketDataScheduler(intervalMs = 5000) {
  if (schedulerInterval) return; // Already running

  console.log(`📊 Starting market data scheduler (${intervalMs}ms interval)`);

  schedulerInterval = setInterval(async () => {
    try {
      const prices = await fetchMarketPrices();
      console.log(`✓ Market data updated:`, {
        BTC: prices['BTC/USDT']?.price?.toString(),
        ETH: prices['ETH/USDT']?.price?.toString(),
      });
    } catch (error) {
      console.error('Scheduler error:', error.message);
    }
  }, intervalMs);

  return schedulerInterval;
}

/**
 * Stop market data scheduler
 */
export function stopMarketDataScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('📊 Market data scheduler stopped');
  }
}

export default {
  fetchMarketPrices,
  getLastTradePrice,
  getMarketStats,
  getMarketConditions,
  startMarketDataScheduler,
  stopMarketDataScheduler,
};
