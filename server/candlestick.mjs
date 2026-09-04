import { prisma } from './db.mjs';

const TIMEFRAMES = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
  '1w': 604800,
};

/**
 * Calculate OHLC (Open, High, Low, Close) from trades within a time window
 * @param {string} marketId - Market ID
 * @param {Date} startTime - Window start
 * @param {Date} endTime - Window end
 * @returns {Object} {open, high, low, close, volume, tradeCount}
 */
async function calculateOHLC(marketId, startTime, endTime) {
  const trades = await prisma.trade.findMany({
    where: {
      marketId,
      createdAt: {
        gte: startTime,
        lt: endTime,
      },
    },
    select: {
      price: true,
      quantity: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  if (trades.length === 0) {
    return null;
  }

  const open = trades[0].price;
  const close = trades[trades.length - 1].price;
  const high = Math.max(...trades.map(t => t.price));
  const low = Math.min(...trades.map(t => t.price));
  const volume = trades.reduce((sum, t) => sum + parseFloat(t.quantity), 0);

  return { open, high, low, close, volume, tradeCount: trades.length };
}

/**
 * Generate candlesticks for a market in a timeframe
 * @param {string} marketId - Market ID
 * @param {string} timeframe - '1m', '5m', '15m', '1h', '4h', '1d', '1w'
 * @param {number} limit - Max candles to return (default 100)
 * @returns {Array} Sorted candlesticks [{timestamp, open, high, low, close, volume, tradeCount}]
 */
async function generateCandlesticks(marketId, timeframe, limit = 100) {
  if (!TIMEFRAMES[timeframe]) {
    throw new Error(`Invalid timeframe: ${timeframe}`);
  }

  const windowSize = TIMEFRAMES[timeframe] * 1000;
  const now = Date.now();
  const startTime = now - windowSize * limit;

  // Query all trades in the range
  const trades = await prisma.trade.findMany({
    where: {
      marketId,
      createdAt: {
        gte: new Date(startTime),
      },
    },
    select: {
      price: true,
      quantity: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  if (trades.length === 0) {
    return [];
  }

  const candlesticks = [];
  let windowStart = new Date(startTime);

  while (windowStart.getTime() < now) {
    const windowEnd = new Date(windowStart.getTime() + windowSize);
    
    const tradesInWindow = trades.filter(
      t => t.createdAt >= windowStart && t.createdAt < windowEnd
    );

    if (tradesInWindow.length > 0) {
      const open = tradesInWindow[0].price;
      const close = tradesInWindow[tradesInWindow.length - 1].price;
      const high = Math.max(...tradesInWindow.map(t => t.price));
      const low = Math.min(...tradesInWindow.map(t => t.price));
      const volume = tradesInWindow.reduce((sum, t) => sum + parseFloat(t.quantity), 0);

      candlesticks.push({
        timestamp: windowStart.toISOString(),
        open: parseFloat(open),
        high: parseFloat(high),
        low: parseFloat(low),
        close: parseFloat(close),
        volume: parseFloat(volume.toFixed(8)),
        tradeCount: tradesInWindow.length,
      });
    }

    windowStart = windowEnd;
  }

  return candlesticks;
}

/**
 * Calculate volume profile: count trades at each price level
 * @param {string} marketId - Market ID
 * @param {number} buckets - Number of price buckets (default 50)
 * @returns {Array} [{priceLevel, volumeCount, buyVolume, sellVolume}]
 */
async function calculateVolumeProfile(marketId, buckets = 50) {
  const trades = await prisma.trade.findMany({
    where: { marketId },
    select: {
      price: true,
      quantity: true,
    },
  });

  if (trades.length === 0) return [];

  const prices = trades.map(t => parseFloat(t.price));
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const bucketSize = (maxPrice - minPrice) / buckets;

  const profile = Array(buckets)
    .fill(null)
    .map((_, i) => {
      const priceLevel = minPrice + bucketSize * i;
      const volumeCount = trades
        .filter(t => {
          const p = parseFloat(t.price);
          return p >= priceLevel && p < priceLevel + bucketSize;
        })
        .reduce((sum, t) => sum + parseFloat(t.quantity), 0);

      return { priceLevel: parseFloat(priceLevel.toFixed(2)), volumeCount };
    })
    .filter(p => p.volumeCount > 0);

  return profile;
}

/**
 * Calculate simple moving average
 * @param {Array} prices - Array of prices
 * @param {number} period - Number of periods
 * @returns {number} SMA value
 */
function calculateSMA(prices, period) {
  if (prices.length < period) return null;
  const sum = prices.slice(-period).reduce((a, b) => a + b, 0);
  return sum / period;
}

/**
 * Calculate exponential moving average
 * @param {Array} prices - Array of prices
 * @param {number} period - Number of periods
 * @returns {number} EMA value
 */
function calculateEMA(prices, period) {
  if (prices.length < period) return null;

  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }

  return ema;
}

/**
 * Calculate RSI (Relative Strength Index)
 * @param {Array} prices - Array of prices
 * @param {number} period - Number of periods (default 14)
 * @returns {number} RSI value (0-100)
 */
function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = prices[prices.length - period + i] - prices[prices.length - period + i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;

  return 100 - 100 / (1 + rs);
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 * @param {Array} prices - Array of prices
 * @returns {Object} {macd, signal, histogram}
 */
function calculateMACD(prices) {
  if (prices.length < 26) return null;

  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);

  if (!ema12 || !ema26) return null;

  const macd = ema12 - ema26;
  const signal = calculateEMA([...prices].slice(0, -1).concat(macd), 9);
  const histogram = macd - signal;

  return {
    macd: parseFloat(macd.toFixed(8)),
    signal: parseFloat(signal?.toFixed(8)),
    histogram: parseFloat(histogram?.toFixed(8)),
  };
}

/**
 * Calculate Bollinger Bands
 * @param {Array} prices - Array of prices
 * @param {number} period - Number of periods (default 20)
 * @param {number} stdDev - Number of standard deviations (default 2)
 * @returns {Object} {upper, middle, lower}
 */
function calculateBollingerBands(prices, period = 20, stdDev = 2) {
  if (prices.length < period) return null;

  const recentPrices = prices.slice(-period);
  const middle = recentPrices.reduce((a, b) => a + b, 0) / period;
  const variance =
    recentPrices.reduce((sum, p) => sum + Math.pow(p - middle, 2), 0) / period;
  const std = Math.sqrt(variance);

  return {
    upper: parseFloat((middle + stdDev * std).toFixed(2)),
    middle: parseFloat(middle.toFixed(2)),
    lower: parseFloat((middle - stdDev * std).toFixed(2)),
  };
}

/**
 * Get technical analysis data for a candlestick
 * @param {string} marketId - Market ID
 * @param {string} timeframe - Timeframe
 * @param {number} limit - Max candlesticks (default 50)
 * @returns {Object} Candlestick with technical indicators
 */
async function getTechnicalAnalysis(marketId, timeframe, limit = 50) {
  const candles = await generateCandlesticks(marketId, timeframe, limit);
  if (candles.length === 0) return null;

  const closes = candles.map(c => c.close);
  const latestCandle = candles[candles.length - 1];

  return {
    ...latestCandle,
    indicators: {
      sma20: calculateSMA(closes, 20),
      sma50: calculateSMA(closes, 50),
      ema12: calculateEMA(closes, 12),
      ema26: calculateEMA(closes, 26),
      rsi14: calculateRSI(closes, 14),
      macd: calculateMACD(closes),
      bollinger20: calculateBollingerBands(closes, 20),
    },
  };
}

export {
  TIMEFRAMES,
  calculateOHLC,
  generateCandlesticks,
  calculateVolumeProfile,
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  getTechnicalAnalysis,
};
