import express from 'express';
import {
  getPortfolioValue,
  getAllocationPercentage,
  getUserPnL,
  getTradingHistory,
  getTradingPerformance,
  getMarketStats,
} from './portfolio.mjs';

const router = express.Router();

// Middleware: Check authentication
const requireAuth = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

/**
 * GET /api/analytics/portfolio
 * User's portfolio overview (requires auth)
 */
router.get('/portfolio', requireAuth, async (req, res) => {
  try {
    const portfolio = await getPortfolioValue(req.user.id);
    const allocation = getAllocationPercentage(portfolio.breakdown);

    res.json({
      ...portfolio,
      allocation,
    });
  } catch (err) {
    console.error('Portfolio error:', err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/analytics/pnl
 * User's Profit & Loss summary (requires auth)
 */
router.get('/pnl', requireAuth, async (req, res) => {
  try {
    const pnl = await getUserPnL(req.user.id);
    res.json(pnl);
  } catch (err) {
    console.error('PnL error:', err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/analytics/history
 * User's trading history (requires auth)
 * Query params: symbol, side, status, limit
 */
router.get('/history', requireAuth, async (req, res) => {
  try {
    const { symbol, side, status, limit } = req.query;

    const history = await getTradingHistory(req.user.id, {
      symbol,
      side,
      status,
      limit: Math.min(parseInt(limit) || 50, 500),
    });

    res.json({
      count: history.length,
      trades: history,
    });
  } catch (err) {
    console.error('History error:', err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/analytics/performance
 * User's trading performance metrics (requires auth)
 */
router.get('/performance', requireAuth, async (req, res) => {
  try {
    const performance = await getTradingPerformance(req.user.id);
    res.json(performance);
  } catch (err) {
    console.error('Performance error:', err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/analytics/market-stats/:symbol
 * Market-wide statistics (public)
 */
router.get('/market-stats/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const stats = await getMarketStats(symbol);
    res.json(stats);
  } catch (err) {
    console.error('Market stats error:', err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/analytics/dashboard
 * Combined dashboard view (requires auth)
 */
router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const [portfolio, pnl, performance] = await Promise.all([
      getPortfolioValue(req.user.id),
      getUserPnL(req.user.id),
      getTradingPerformance(req.user.id),
    ]);

    const allocation = getAllocationPercentage(portfolio.breakdown);

    res.json({
      portfolio: {
        ...portfolio,
        allocation,
      },
      pnl,
      performance,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(400).json({ error: err.message });
  }
});

export default router;
