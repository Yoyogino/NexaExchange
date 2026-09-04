# Phase 3: Real-Time Trading & Market Data - IMPLEMENTATION GUIDE

## Overview
Phase 3 adds real-time market data feeds, WebSocket streaming for live orderbook updates, and a comprehensive admin dashboard for system monitoring.

## Components

### 1. Market Data Service (`server/market-data.mjs`)
Fetches and caches cryptocurrency prices from CoinGecko API.

**Features:**
- ✅ 5-second price cache (avoid API throttling)
- ✅ Graceful fallback on API errors
- ✅ 24h market statistics (volume, high/low)
- ✅ Market spread and best bid/ask calculation
- ✅ Automatic scheduler (5-second updates)

**Functions:**
```javascript
// Fetch prices from CoinGecko
const prices = await fetchMarketPrices();
// Returns: { 'BTC/USDT': { price: Decimal, marketCap: number }, ... }

// Get last trade price
const price = await getLastTradePrice('BTC/USDT');

// Get market statistics (24h)
const stats = await getMarketStats('BTC/USDT');
// Returns: { symbol, lastPrice, highPrice, lowPrice, volume24h, trades24h }

// Get full market conditions (price + orderbook)
const conditions = await getMarketConditions('BTC/USDT');
// Returns: { externalPrice, bestBid, bestAsk, spread, stats, ... }

// Start automatic price updates
startMarketDataScheduler(5000); // Update every 5 seconds
```

### 2. WebSocket Server (`server/websocket.mjs`)
Real-time streaming of orderbook, trades, and order updates using Socket.io.

**Events:**

**Client → Server:**
```javascript
// Authentication
socket.emit('auth', { userId: 'user_123' });

// Subscribe to orderbook updates
socket.emit('subscribe:orderbook', 'BTC/USDT');

// Subscribe to all trades
socket.emit('subscribe:trades', 'BTC/USDT');

// Subscribe to personal orders
socket.emit('subscribe:myorders');
```

**Server → Client:**
```javascript
// Orderbook snapshot (on subscribe)
socket.on('orderbook:snapshot', ({ symbol, data }) => {
  // { symbol: 'BTC/USDT', data: { bestBid, bestAsk, externalPrice, ... } }
});

// Orderbook update (when orders placed/filled)
socket.on('orderbook:update', ({ symbol, data }) => {
  // Real-time orderbook changes
});

// Trade executed
socket.on('trade:executed', (trade) => {
  // { id, symbol, price, quantity, fee, timestamp, side }
});

// Personal order update
socket.on('order:update', (order) => {
  // { id, symbol, side, status, filledAmount, ... }
});

// Price update (all subscribers)
socket.on('prices:update', ({ BTC, ETH, timestamp }) => {
  // Latest prices from market data service
});
```

**Example Client Code:**
```javascript
import io from 'socket.io-client';

const socket = io('https://shopboostlabs.com');

// Authenticate
socket.emit('auth', { userId: 'user_123' });

// Subscribe to BTC/USDT orderbook
socket.emit('subscribe:orderbook', 'BTC/USDT');
socket.on('orderbook:update', (data) => {
  console.log('Orderbook updated:', data);
});

// Subscribe to trades
socket.emit('subscribe:trades', 'BTC/USDT');
socket.on('trade:executed', (trade) => {
  console.log('Trade executed:', trade);
});

// Personal orders
socket.emit('subscribe:myorders');
socket.on('order:update', (order) => {
  console.log('Order status:', order.status);
});
```

### 3. Admin Dashboard (`server/admin-dashboard.mjs`)
Monitoring and system administration endpoints.

**Endpoints:**

#### GET /api/admin/dashboard
Complete dashboard overview.

**Response:**
```json
{
  "timestamp": "2026-09-04T06:55:00Z",
  "users": {
    "total": 1250,
    "new24h": 45,
    "activeTraders24h": 127
  },
  "trading": {
    "markets": 2,
    "activeOrders": 543,
    "trades24h": 2150,
    "totalTrades": 15430,
    "volume24h": "2345678.50",
    "fees24h": "2345.67"
  },
  "network": {
    "totalConnections": 89,
    "authenticatedUsers": 42,
    "rooms": [
      { "name": "orderbook:BTC/USDT", "subscribers": 34 },
      { "name": "trades:BTC/USDT", "subscribers": 28 }
    ]
  },
  "markets": [
    { "symbol": "BTC/USDT", "orders": 300, "trades": 1200 }
  ]
}
```

#### GET /api/admin/metrics/realtime
Real-time system metrics.

**Response:**
```json
{
  "timestamp": "2026-09-04T06:55:00Z",
  "process": {
    "uptime": 86400,
    "memory": {
      "rss": 256,
      "heap": 128,
      "external": 12
    },
    "cpu": { "user": 45000, "system": 12000 }
  },
  "trading": {
    "activeOrders": 543
  },
  "network": { "totalConnections": 89 }
}
```

#### GET /api/admin/users/flagged
Find suspicious accounts (possible bots/spam).

**Response:**
```json
{
  "flagged": [
    {
      "id": "user_123",
      "email": "bot@test.com",
      "joinedAt": "2026-09-04T00:00:00Z",
      "orders24h": 150,
      "flagReason": "High trading frequency (possible bot)"
    }
  ],
  "count": 1
}
```

#### GET /api/admin/trades/summary?hours=24&symbol=BTC/USDT
Trading activity summary by market.

**Response:**
```json
{
  "period": "24h",
  "totalTrades": 2150,
  "totalVolume": "2345678.50",
  "totalFees": "2345.67",
  "byMarket": [
    {
      "symbol": "BTC/USDT",
      "trades": 2150,
      "volume": "2345678.50",
      "fees": "2345.67",
      "avgPrice": "40150.25",
      "highPrice": "42100.00",
      "lowPrice": "39500.00"
    }
  ]
}
```

#### GET /api/admin/alerts
Critical system alerts and warnings.

**Response:**
```json
{
  "alerts": [
    {
      "severity": "warning",
      "message": "5 orders pending for >1 hour",
      "action": "Review order matching engine"
    }
  ],
  "severity": "warning"
}
```

## Integration with Existing Systems

### Order Matching Engine
When an order is placed and matched:
1. Order matching engine creates trades
2. Admin dashboard tracks statistics
3. WebSocket broadcasts updates to subscribers:
   - `order:update` to order owner
   - `trade:executed` to trade subscribers
   - `orderbook:update` to orderbook subscribers

### Ledger System
- Admin can query user balances via dashboard
- All balance changes recorded in ledger (audit trail)
- Suspicious patterns detected automatically

## Configuration

### Market Data Scheduler
```javascript
// In server/index.mjs
import { startMarketDataScheduler, stopMarketDataScheduler } from './market-data.mjs';

// Start on server startup
startMarketDataScheduler(5000); // 5-second interval

// Stop on graceful shutdown
process.on('SIGTERM', () => {
  stopMarketDataScheduler();
  // ... cleanup
});
```

### WebSocket Server
```javascript
// In server/index.mjs
import { initWebSocket } from './websocket.mjs';
import { Server } from 'socket.io';

const httpServer = createServer(app);
const io = initWebSocket(httpServer);

httpServer.listen(3001, () => {
  console.log('WebSocket server listening on :3001');
});
```

### Admin Routes
```javascript
// In server/index.mjs
import adminDashboard from './admin-dashboard.mjs';

app.use('/api/admin', adminDashboard);
```

## Performance Considerations

### Caching
- **Market prices**: 5-second cache (CoinGecko API limit)
- **Orderbook snapshots**: Generated on-demand
- **Market stats**: Calculated from trades (indexed queries)

### Database Indexes
Ensure these indexes exist for performance:
```sql
CREATE INDEX "Order_userId_idx" ON "Order"("userId");
CREATE INDEX "Order_marketId_idx" ON "Order"("marketId");
CREATE INDEX "Order_status_idx" ON "Order"("status");
CREATE INDEX "Trade_marketId_idx" ON "Trade"("marketId");
CREATE INDEX "Trade_createdAt_idx" ON "Trade"("createdAt");
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");
```

### WebSocket Scalability
- Socket.io with default adapter (single server)
- For multi-server: configure Redis adapter
- Each orderbook subscription uses minimal memory

## Testing

Run Phase 3 tests:
```bash
npm test -- tests/phase3-integration.test.mjs
```

**Test Coverage:**
- ✅ Price fetching and caching
- ✅ Market statistics calculation
- ✅ WebSocket trade events
- ✅ Order update streaming
- ✅ Suspicious pattern detection
- ✅ Admin dashboard metrics

## Security

### Admin Authentication
- All admin endpoints require admin role
- Check via middleware before each request
- Logged in audit trail

### Rate Limiting
Recommended: Add rate limiting to public endpoints
```javascript
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
}));
```

### WebSocket Auth
- Require authentication before subscribing
- Token validation on each connection
- Audit WebSocket events

## Future Enhancements

### Phase 4 (Planned)
- [ ] Candlestick charts (1m, 5m, 15m, 1h, 1d)
- [ ] Order book depth charts
- [ ] Trading volume indicators
- [ ] User portfolio tracking
- [ ] Mobile app notifications

### Phase 5 (Planned)
- [ ] Advanced order types (stop-loss, take-profit)
- [ ] Margin trading
- [ ] Futures contracts
- [ ] API documentation (OpenAPI/Swagger)

## Monitoring & Alerts

Key metrics to monitor:
- **Order latency**: Time from placement to execution
- **Orderbook depth**: Bid/ask levels with volume
- **WebSocket connections**: Active subscribers per room
- **API response times**: Market data fetch latency
- **System resources**: Memory, CPU, database connections

**Alert Thresholds:**
- Orders stuck > 1 hour → Warning
- Memory usage > 80% → Critical
- Database latency > 500ms → Warning
- WebSocket disconnects spike → Check network

## Troubleshooting

### WebSocket not connecting
1. Check browser console for errors
2. Verify CORS enabled on server
3. Check firewall (WebSocket uses different port sometimes)
4. Verify Socket.io version compatibility

### Market prices not updating
1. Check CoinGecko API status
2. Verify scheduler is running (`startMarketDataScheduler`)
3. Check for network errors in logs
4. Verify subscription to `prices:update` event

### Admin dashboard slow
1. Check database query performance
2. Verify indexes exist on tables
3. Monitor database connection pool
4. Consider caching admin metrics

---

**Status**: Phase 3 Implementation Complete ✅
**Ready for**: Deployment & Testing
**Next Phase**: Phase 4 (Advanced Charts & Analytics)
