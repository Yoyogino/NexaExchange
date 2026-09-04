import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

const prisma = new PrismaClient();
const router = Router();

// Get all active markets
router.get('/markets', async (req, res) => {
  try {
    const markets = await prisma.market.findMany({
      where: { isActive: true },
      select: {
        id: true,
        symbol: true,
        baseCurrency: true,
        quoteCurrency: true,
      },
    });
    res.json(markets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get orderbook for a specific market
router.get('/orderbook/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    
    const market = await prisma.market.findUnique({
      where: { symbol },
    });

    if (!market) {
      return res.status(404).json({ error: 'Market not found' });
    }

    // Get buy orders (limit orders only, sorted by price descending)
    const buyOrders = await prisma.order.findMany({
      where: {
        marketId: market.id,
        side: 'BUY',
        status: { in: ['PENDING', 'PARTIALLY_FILLED'] },
        type: 'LIMIT',
      },
      orderBy: { price: 'desc' },
      take: 20,
      select: {
        price: true,
        quantity: true,
        filledAmount: true,
      },
    });

    // Get sell orders (limit orders only, sorted by price ascending)
    const sellOrders = await prisma.order.findMany({
      where: {
        marketId: market.id,
        side: 'SELL',
        status: { in: ['PENDING', 'PARTIALLY_FILLED'] },
        type: 'LIMIT',
      },
      orderBy: { price: 'asc' },
      take: 20,
      select: {
        price: true,
        quantity: true,
        filledAmount: true,
      },
    });

    // Group orders by price level
    const groupByPrice = (orders) => {
      const grouped = {};
      orders.forEach(order => {
        const priceKey = order.price.toString();
        if (!grouped[priceKey]) {
          grouped[priceKey] = new Decimal(0);
        }
        grouped[priceKey] = grouped[priceKey].plus(order.quantity.minus(order.filledAmount));
      });
      return Object.entries(grouped).map(([price, quantity]) => ({
        price: parseFloat(price),
        quantity: quantity.toFixed(8),
      }));
    };

    res.json({
      symbol,
      bids: groupByPrice(buyOrders),
      asks: groupByPrice(sellOrders),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Place a new order
router.post('/orders', async (req, res) => {
  try {
    const { userId, symbol, side, type, price, quantity } = req.body;

    // Validate input
    if (!userId || !symbol || !side || !type || !quantity) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (type === 'LIMIT' && !price) {
      return res.status(400).json({ error: 'Price required for limit orders' });
    }

    // Get market
    const market = await prisma.market.findUnique({
      where: { symbol },
    });

    if (!market) {
      return res.status(404).json({ error: 'Market not found' });
    }

    // Create order
    const order = await prisma.order.create({
      data: {
        userId,
        marketId: market.id,
        side,
        type,
        price: type === 'LIMIT' ? new Decimal(price) : null,
        quantity: new Decimal(quantity),
      },
      include: {
        market: {
          select: { symbol: true },
        },
      },
    });

    // TODO: Trigger matching engine

    res.status(201).json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user's orders
router.get('/orders', async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    const orders = await prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        market: {
          select: { symbol: true },
        },
      },
    });

    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cancel an order
router.delete('/orders/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { userId } = req.body;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (order.status === 'FILLED' || order.status === 'CANCELLED') {
      return res.status(400).json({ error: `Cannot cancel ${order.status} order` });
    }

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED' },
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
