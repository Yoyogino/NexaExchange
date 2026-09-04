import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { getWebSocketStats } from './websocket.mjs';

const prisma = new PrismaClient();
const router = Router();

// Middleware: Check if user is admin
const requireAdmin = async (req, res, next) => {
  const { userId } = req.headers;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user || user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  req.adminUser = user;
  next();
};

// Apply admin middleware to all routes
router.use(requireAdmin);

// ==================== DASHBOARD OVERVIEW ====================

/**
 * GET /api/admin/dashboard
 * Complete dashboard overview with all key metrics
 */
router.get('/dashboard', async (req, res) => {
  try {
    const now = new Date();
    const hour24AgoMs = 24 * 60 * 60 * 1000;
    const hour1AgoMs = 60 * 60 * 1000;

    // Fetch metrics in parallel
    const [
      totalUsers,
      newUsers24h,
      activeTraders,
      totalTrades,
      trades24h,
      activeOrders,
      markets,
      wsStats,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({
        where: { createdAt: { gte: new Date(now.getTime() - hour24AgoMs) } },
      }),
      prisma.order.findMany({
        distinct: ['userId'],
        where: {
          createdAt: { gte: new Date(now.getTime() - hour24AgoMs) },
        },
        select: { userId: true },
      }),
      prisma.trade.count(),
      prisma.trade.count({
        where: { createdAt: { gte: new Date(now.getTime() - hour24AgoMs) } },
      }),
      prisma.order.count({
        where: { status: { in: ['PENDING', 'PARTIALLY_FILLED'] } },
      }),
      prisma.market.findMany({
        include: {
          _count: { select: { orders: true, trades: true } },
        },
      }),
      new Promise(resolve => resolve(getWebSocketStats())),
    ]);

    // Calculate volume
    const tradesData = await prisma.trade.findMany({
      where: { createdAt: { gte: new Date(now.getTime() - hour24AgoMs) } },
      select: { quantity: true, price: true, fee: true },
    });

    const volume24h = tradesData.reduce((sum, t) => sum + (t.quantity * t.price), 0);
    const fees24h = tradesData.reduce((sum, t) => sum + t.fee, 0);

    res.json({
      timestamp: now,
      users: {
        total: totalUsers,
        new24h: newUsers24h,
        activeTraders24h: activeTraders.length,
      },
      trading: {
        markets: markets.length,
        activeOrders,
        trades24h,
        totalTrades,
        volume24h: volume24h.toFixed(2),
        fees24h: fees24h.toFixed(2),
      },
      network: wsStats,
      markets: markets.map(m => ({
        symbol: m.symbol,
        orders: m._count.orders,
        trades: m._count.trades,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== REAL-TIME METRICS ====================

/**
 * GET /api/admin/metrics/realtime
 * Real-time system metrics (updated every 5 seconds on client)
 */
router.get('/metrics/realtime', async (req, res) => {
  try {
    const memory = process.memoryUsage();
    const uptime = process.uptime();

    const activeOrders = await prisma.order.count({
      where: { status: { in: ['PENDING', 'PARTIALLY_FILLED'] } },
    });

    res.json({
      timestamp: new Date(),
      process: {
        uptime: Math.floor(uptime),
        memory: {
          rss: Math.round(memory.rss / 1024 / 1024), // MB
          heap: Math.round(memory.heapUsed / 1024 / 1024),
          external: Math.round(memory.external / 1024 / 1024),
        },
        cpu: process.cpuUsage(),
      },
      trading: {
        activeOrders,
      },
      network: getWebSocketStats(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== USER MONITORING ====================

/**
 * GET /api/admin/users/flagged
 * Find suspicious user accounts
 */
router.get('/users/flagged', async (req, res) => {
  try {
    // Find users with very high trading frequency (possible bot/spam)
    const hour24AgoMs = 24 * 60 * 60 * 1000;
    const now = new Date();

    const suspiciousUsers = await prisma.user.findMany({
      where: {
        orders: {
          some: {
            createdAt: { gte: new Date(now.getTime() - hour24AgoMs) },
          },
        },
      },
      select: {
        id: true,
        email: true,
        createdAt: true,
        _count: {
          select: {
            orders: true,
          },
        },
      },
    });

    // Filter: more than 100 orders in 24h = suspicious
    const flagged = suspiciousUsers
      .filter(u => u._count.orders > 100)
      .map(u => ({
        id: u.id,
        email: u.email,
        joinedAt: u.createdAt,
        orders24h: u._count.orders,
        flagReason: 'High trading frequency (possible bot)',
      }))
      .sort((a, b) => b.orders24h - a.orders24h);

    res.json({ flagged, count: flagged.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== TRADE ANALYSIS ====================

/**
 * GET /api/admin/trades/summary
 * Trading activity summary
 */
router.get('/trades/summary', async (req, res) => {
  try {
    const { hours = 24, symbol } = req.query;
    const hoursAgoMs = hours * 60 * 60 * 1000;
    const now = new Date();

    let where = {
      createdAt: { gte: new Date(now.getTime() - hoursAgoMs) },
    };

    if (symbol) {
      const market = await prisma.market.findUnique({ where: { symbol } });
      if (market) where.marketId = market.id;
    }

    const trades = await prisma.trade.findMany({
      where,
      include: { market: { select: { symbol: true } } },
    });

    // Group by market
    const byMarket = {};
    trades.forEach(t => {
      if (!byMarket[t.market.symbol]) {
        byMarket[t.market.symbol] = {
          count: 0,
          volume: 0,
          fees: 0,
          prices: [],
        };
      }
      byMarket[t.market.symbol].count += 1;
      byMarket[t.market.symbol].volume += t.quantity * t.price;
      byMarket[t.market.symbol].fees += t.fee;
      byMarket[t.market.symbol].prices.push(t.price);
    });

    // Calculate stats
    const summary = Object.entries(byMarket).map(([symbol, data]) => ({
      symbol,
      trades: data.count,
      volume: data.volume.toFixed(2),
      fees: data.fees.toFixed(8),
      avgPrice: (data.prices.reduce((a, b) => a + b, 0) / data.prices.length).toFixed(2),
      highPrice: Math.max(...data.prices).toFixed(2),
      lowPrice: Math.min(...data.prices).toFixed(2),
    }));

    res.json({
      period: `${hours}h`,
      totalTrades: trades.length,
      totalVolume: trades.reduce((sum, t) => sum + (t.quantity * t.price), 0).toFixed(2),
      totalFees: trades.reduce((sum, t) => sum + t.fee, 0).toFixed(8),
      byMarket: summary,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== SYSTEM ALERTS ====================

/**
 * GET /api/admin/alerts
 * Critical system alerts
 */
router.get('/alerts', async (req, res) => {
  try {
    const alerts = [];

    // Check for stalled orders (pending > 1 hour)
    const stalledOrders = await prisma.order.count({
      where: {
        status: { in: ['PENDING', 'PARTIALLY_FILLED'] },
        createdAt: {
          lte: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
        },
      },
    });

    if (stalledOrders > 0) {
      alerts.push({
        severity: 'warning',
        message: `${stalledOrders} orders pending for >1 hour`,
        action: 'Review order matching engine',
      });
    }

    // Check for zero volume markets
    const markets = await prisma.market.findMany({
      where: { isActive: true },
      include: {
        _count: { select: { trades: true } },
      },
    });

    markets.forEach(m => {
      if (m._count.trades === 0) {
        alerts.push({
          severity: 'info',
          message: `No trades on ${m.symbol} since market creation`,
          action: 'Monitor market adoption',
        });
      }
    });

    res.json({ alerts, severity: alerts.length > 0 ? 'warning' : 'ok' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
