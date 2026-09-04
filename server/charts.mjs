import express from 'express';
import { prisma } from './db.mjs';
import {
  generateCandlesticks,
  calculateVolumeProfile,
  getTechnicalAnalysis,
} from './candlestick.mjs';

const router = express.Router();

/**
 * GET /api/charts/candlesticks/:symbol/:timeframe
 * Returns OHLC candlesticks for charting
 * Query params: limit (1-500, default 100)
 */
router.get('/candlesticks/:symbol/:timeframe', async (req, res) => {
  try {
    const { symbol, timeframe } = req.params;
    let { limit } = req.query;

    limit = Math.min(Math.max(parseInt(limit) || 100, 1), 500);

    const market = await prisma.market.findUnique({
      where: { symbol },
    });

    if (!market) {
      return res.status(404).json({ error: 'Market not found' });
    }

    const candles = await generateCandlesticks(market.id, timeframe, limit);

    res.json({
      symbol,
      timeframe,
      data: candles,
      count: candles.length,
    });
  } catch (err) {
    console.error('Candlestick error:', err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/charts/volume-profile/:symbol
 * Returns volume distribution by price level
 * Query params: buckets (1-200, default 50)
 */
router.get('/volume-profile/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    let { buckets } = req.query;

    buckets = Math.min(Math.max(parseInt(buckets) || 50, 1), 200);

    const market = await prisma.market.findUnique({
      where: { symbol },
    });

    if (!market) {
      return res.status(404).json({ error: 'Market not found' });
    }

    const profile = await calculateVolumeProfile(market.id, buckets);

    res.json({
      symbol,
      buckets,
      data: profile,
      count: profile.length,
    });
  } catch (err) {
    console.error('Volume profile error:', err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/charts/technical-analysis/:symbol/:timeframe
 * Returns latest candle with technical indicators
 */
router.get('/technical-analysis/:symbol/:timeframe', async (req, res) => {
  try {
    const { symbol, timeframe } = req.params;

    const market = await prisma.market.findUnique({
      where: { symbol },
    });

    if (!market) {
      return res.status(404).json({ error: 'Market not found' });
    }

    const analysis = await getTechnicalAnalysis(market.id, timeframe);

    if (!analysis) {
      return res.status(404).json({ error: 'No price data available' });
    }

    res.json({
      symbol,
      timeframe,
      ...analysis,
    });
  } catch (err) {
    console.error('Technical analysis error:', err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/charts/supports/:symbol
 * Returns supported timeframes and data availability for a symbol
 */
router.get('/supports/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;

    const market = await prisma.market.findUnique({
      where: { symbol },
    });

    if (!market) {
      return res.status(404).json({ error: 'Market not found' });
    }

    const tradeCount = await prisma.trade.count({
      where: { marketId: market.id },
    });

    res.json({
      symbol,
      supported: true,
      tradeCount,
      timeframes: ['1m', '5m', '15m', '1h', '4h', '1d', '1w'],
      maxCandleLimit: 500,
      lastUpdate: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Supports endpoint error:', err);
    res.status(400).json({ error: err.message });
  }
});

export default router;
