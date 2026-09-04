import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import { getMarketConditions, fetchMarketPrices } from './market-data.mjs';

const prisma = new PrismaClient();

let io = null;
const connectedClients = new Map(); // userId -> Set of socket ids

/**
 * Initialize WebSocket server
 */
export function initWebSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  io.on('connection', (socket) => {
    console.log(`📡 Client connected: ${socket.id}`);

    // Track client
    socket.on('auth', (userId) => {
      if (!connectedClients.has(userId)) {
        connectedClients.set(userId, new Set());
      }
      connectedClients.get(userId).add(socket.id);
      socket.userId = userId;
      console.log(`✓ User ${userId} authenticated`);
    });

    // Subscribe to orderbook updates
    socket.on('subscribe:orderbook', async (symbol) => {
      socket.join(`orderbook:${symbol}`);
      console.log(`✓ Client subscribed to ${symbol}`);

      // Send current orderbook state
      const conditions = await getMarketConditions(symbol);
      socket.emit('orderbook:snapshot', { symbol, data: conditions });
    });

    // Subscribe to trades
    socket.on('subscribe:trades', (symbol) => {
      socket.join(`trades:${symbol}`);
      console.log(`✓ Client subscribed to trades:${symbol}`);
    });

    // Subscribe to personal orders
    socket.on('subscribe:myorders', () => {
      if (!socket.userId) {
        socket.emit('error', { message: 'Not authenticated' });
        return;
      }
      socket.join(`myorders:${socket.userId}`);
      console.log(`✓ User ${socket.userId} subscribed to personal orders`);
    });

    // Disconnect handling
    socket.on('disconnect', () => {
      if (socket.userId && connectedClients.has(socket.userId)) {
        connectedClients.get(socket.userId).delete(socket.id);
        if (connectedClients.get(socket.userId).size === 0) {
          connectedClients.delete(socket.userId);
        }
      }
      console.log(`📡 Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

/**
 * Broadcast orderbook update to all subscribers
 */
export async function broadcastOrderbookUpdate(symbol) {
  if (!io) return;

  const conditions = await getMarketConditions(symbol);
  io.to(`orderbook:${symbol}`).emit('orderbook:update', { symbol, data: conditions });
}

/**
 * Broadcast trade to subscribers
 */
export async function broadcastTrade(trade, buyerUserId, sellerUserId) {
  if (!io) return;

  const market = await prisma.market.findUnique({
    where: { id: trade.marketId },
  });

  const tradeData = {
    id: trade.id,
    symbol: market.symbol,
    price: trade.price.toString(),
    quantity: trade.quantity.toString(),
    fee: trade.fee.toString(),
    timestamp: trade.createdAt,
  };

  // Broadcast to all trade subscribers
  io.to(`trades:${market.symbol}`).emit('trade:executed', tradeData);

  // Notify parties
  if (connectedClients.has(buyerUserId)) {
    connectedClients.get(buyerUserId).forEach(socketId => {
      io.to(socketId).emit('trade:myexecution', {
        ...tradeData,
        side: 'BUY',
      });
    });
  }

  if (connectedClients.has(sellerUserId)) {
    connectedClients.get(sellerUserId).forEach(socketId => {
      io.to(socketId).emit('trade:myexecution', {
        ...tradeData,
        side: 'SELL',
      });
    });
  }

  // Update orderbook
  await broadcastOrderbookUpdate(market.symbol);
}

/**
 * Broadcast order update to user
 */
export async function broadcastOrderUpdate(order, userId) {
  if (!io) return;

  const market = await prisma.market.findUnique({
    where: { id: order.marketId },
  });

  const orderData = {
    id: order.id,
    symbol: market.symbol,
    side: order.side,
    type: order.type,
    price: order.price?.toString(),
    quantity: order.quantity.toString(),
    filledAmount: order.filledAmount.toString(),
    status: order.status,
    timestamp: order.updatedAt,
  };

  // Notify user if connected
  if (connectedClients.has(userId)) {
    connectedClients.get(userId).forEach(socketId => {
      io.to(socketId).emit('order:update', orderData);
    });
  }
}

/**
 * Broadcast market price update
 */
export async function broadcastPriceUpdate() {
  if (!io) return;

  const prices = await fetchMarketPrices();

  io.emit('prices:update', {
    BTC: prices['BTC/USDT']?.price?.toString(),
    ETH: prices['ETH/USDT']?.price?.toString(),
    timestamp: new Date(),
  });
}

/**
 * Get connection stats
 */
export function getWebSocketStats() {
  if (!io) return null;

  return {
    totalConnections: io.engine.clientsCount,
    authenticatedUsers: connectedClients.size,
    rooms: Array.from(io.sockets.adapter.rooms.entries())
      .filter(([name]) => !name.startsWith('/'))
      .map(([name, sockets]) => ({
        name,
        subscribers: sockets.size,
      })),
  };
}

export default {
  initWebSocket,
  broadcastOrderbookUpdate,
  broadcastTrade,
  broadcastOrderUpdate,
  broadcastPriceUpdate,
  getWebSocketStats,
};
