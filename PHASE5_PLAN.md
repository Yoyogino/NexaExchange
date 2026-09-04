# 📋 PHASE 5: ADVANCED TRADING FEATURES - IMPLEMENTATION PLAN

**Phase:** 5 (Advanced Trading)  
**Timeline:** 2-3 weeks  
**Dependencies:** Phase 1-4 complete ✅  
**Risk Level:** 🟡 MEDIUM (complex order logic)  

---

## 🎯 PHASE 5 OVERVIEW

Add sophisticated trading features: Stop-Loss, Take-Profit, Trailing Stops, and Real-Time WebSocket Streaming.

### Core Features (MVP)

| Feature | Priority | Complexity | Tests | Estimate |
|---------|----------|-----------|-------|----------|
| Stop-Loss Orders | HIGH | Medium | 8 | 3 days |
| Take-Profit Orders | HIGH | Medium | 8 | 3 days |
| Trailing Stops | MEDIUM | High | 6 | 2 days |
| WebSocket Candles | HIGH | Medium | 6 | 2 days |
| Linked Orders | MEDIUM | High | 5 | 1 day |
| Backtesting API | LOW | High | 4 | 2 days |

---

## 📊 DATABASE SCHEMA UPDATES

### New Tables

**`advanced_orders`** - Store stop-loss, take-profit, trailing stops
```sql
CREATE TABLE advanced_orders (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  market_id UUID NOT NULL,
  order_type VARCHAR(20), -- 'STOP_LOSS', 'TAKE_PROFIT', 'TRAILING_STOP'
  trigger_type VARCHAR(20), -- 'PRICE', 'PERCENTAGE', 'TRAIL'
  trigger_value DECIMAL(28,8),
  order_side VARCHAR(10), -- 'BUY', 'SELL'
  quantity DECIMAL(28,8),
  linked_order_id UUID, -- Links TP to SL
  status VARCHAR(20), -- 'ACTIVE', 'TRIGGERED', 'FILLED', 'CANCELED'
  triggered_at TIMESTAMP,
  filled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**`trailing_stop_history`** - Track trailing stop adjustments
```sql
CREATE TABLE trailing_stop_history (
  id UUID PRIMARY KEY,
  advanced_order_id UUID NOT NULL,
  previous_trigger DECIMAL(28,8),
  new_trigger DECIMAL(28,8),
  market_price DECIMAL(28,8),
  adjusted_at TIMESTAMP DEFAULT NOW()
);
```

**`order_chains`** - Link SL/TP to original position
```sql
CREATE TABLE order_chains (
  id UUID PRIMARY KEY,
  parent_trade_id UUID NOT NULL, -- Original buy/sell
  stop_loss_id UUID,
  take_profit_id UUID,
  trailing_stop_id UUID,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Updated Tables

**`ledger_entries`** - Add advanced order fields
```sql
ALTER TABLE ledger_entries ADD COLUMN advanced_order_id UUID;
ALTER TABLE ledger_entries ADD COLUMN order_chain_id UUID;
```

---

## 🏗️ ARCHITECTURE

### Stop-Loss Orders

**Flow:**
```
1. User creates trade (BUY 1 BTC at $40,000)
2. User sets stop-loss (SELL if price < $38,000)
3. System monitors market price
4. When price <= $38,000:
   - Create market SELL order
   - Execute immediately
   - Record in ledger
   - Update portfolio
5. Notify user
```

**Implementation:**
```javascript
// server/advanced-orders.mjs
- createStopLossOrder(userId, symbol, price, quantity)
- activateStopLossMonitor(orderId)
- checkStopLossTriggered(market, price)
- executeStopLoss(orderId, market)
```

### Take-Profit Orders

**Flow:**
```
1. User creates trade (BUY 1 BTC at $40,000)
2. User sets take-profit (SELL if price > $45,000)
3. System monitors market price
4. When price >= $45,000:
   - Create market SELL order
   - Execute immediately
   - Lock in profits
5. Notify user
```

**Implementation:**
```javascript
// server/advanced-orders.mjs
- createTakeProfitOrder(userId, symbol, price, quantity)
- activateTakeProfitMonitor(orderId)
- checkTakeProfitTriggered(market, price)
- executeTakeProfit(orderId, market)
```

### Trailing Stops

**Flow:**
```
1. User creates trade (BUY 1 BTC at $40,000)
2. User sets trailing stop (5% trail)
3. Price goes to $42,000:
   - Trail update: Stop at $39,900 (5% below $42,000)
4. Price goes to $45,000:
   - Trail update: Stop at $42,750 (5% below $45,000)
5. Price drops to $42,700:
   - Trigger! Price < $42,750
   - Execute SELL at market
6. Profit locked at ~$2,700
```

**Implementation:**
```javascript
// server/trailing-stop.mjs
- createTrailingStop(userId, symbol, trailPercent, quantity)
- activateTrailingStopMonitor(orderId)
- updateTrailingStop(orderId, newPrice)
- checkTrailingStopTriggered(price)
- executeTrailingStop(orderId)
```

### WebSocket Real-Time Streaming

**New Events:**
```javascript
// Socket.io events
socket.emit('candlestick:1m', {symbol, timestamp, ohlcv});
socket.emit('indicator:update', {symbol, timeframe, indicators});
socket.emit('order:created', {orderId, type, trigger});
socket.emit('order:triggered', {orderId, price, side});
socket.emit('order:executed', {orderId, fillPrice, quantity});
socket.emit('portfolio:updated', {assets, totalValue});
```

**Implementation:**
```javascript
// server/websocket-streaming.mjs
- streamCandlesticks(socket, symbol, timeframe)
- streamIndicators(socket, symbol, timeframe)
- streamOrderUpdates(socket, userId)
- streamPortfolio(socket, userId)
```

---

## 📝 FILE STRUCTURE

### New Files to Create

```
server/
  ├── advanced-orders.mjs         (300 lines) - SL/TP logic
  ├── trailing-stop.mjs           (250 lines) - Trailing stop logic
  ├── order-chains.mjs            (150 lines) - Link orders together
  ├── websocket-streaming.mjs     (200 lines) - Real-time updates
  ├── monitor-service.mjs         (200 lines) - Background monitoring

migrations/
  ├── 005-advanced-orders-schema.sql
  ├── 006-trailing-stop-schema.sql
  ├── 007-order-chains-schema.sql

tests/
  ├── phase5-advanced-orders.test.mjs    (400+ lines)
  ├── phase5-trailing-stops.test.mjs     (300+ lines)
  ├── phase5-websocket-streaming.test.mjs (200+ lines)

docs/
  ├── PHASE5_ADVANCED_ORDERS.md (API reference)
  ├── PHASE5_WEBSOCKET_GUIDE.md  (WebSocket guide)
```

---

## 🧪 TEST PLAN

### Stop-Loss Tests (8 tests)
```
✅ Create stop-loss order
✅ Validate trigger price
✅ Trigger at exact price
✅ Trigger below trigger price
✅ Don't trigger above trigger price
✅ Execute stop-loss
✅ Update ledger with stop-loss
✅ Cancel stop-loss
```

### Take-Profit Tests (8 tests)
```
✅ Create take-profit order
✅ Validate trigger price
✅ Trigger at exact price
✅ Trigger above trigger price
✅ Don't trigger below trigger price
✅ Execute take-profit
✅ Update ledger with take-profit
✅ Cancel take-profit
```

### Trailing Stop Tests (6 tests)
```
✅ Create trailing stop
✅ Update trail on price increase
✅ Update trail on price decrease
✅ Don't update trail on small move
✅ Trigger when price falls below trail
✅ Lock in maximum profit
```

### WebSocket Tests (6 tests)
```
✅ Connect to WebSocket
✅ Subscribe to candlesticks
✅ Receive real-time candles
✅ Subscribe to orders
✅ Receive order updates
✅ Subscribe to portfolio
✅ Receive portfolio updates
```

### Integration Tests (8 tests)
```
✅ Create trade + SL + TP chain
✅ Trigger SL (cancel TP)
✅ Trigger TP (cancel SL)
✅ Trailing stop adjusts with price
✅ Multiple orders coexist
✅ Portfolio updates with triggers
✅ Ledger records all changes
✅ WebSocket notifies in real-time
```

**Total Tests:** 36+ tests, targeting 98%+ coverage

---

## 📊 API ENDPOINTS

### New REST Endpoints

```
POST   /api/orders/stop-loss
GET    /api/orders/stop-loss/:orderId
PUT    /api/orders/stop-loss/:orderId
DELETE /api/orders/stop-loss/:orderId

POST   /api/orders/take-profit
GET    /api/orders/take-profit/:orderId
PUT    /api/orders/take-profit/:orderId
DELETE /api/orders/take-profit/:orderId

POST   /api/orders/trailing-stop
GET    /api/orders/trailing-stop/:orderId
PUT    /api/orders/trailing-stop/:orderId
DELETE /api/orders/trailing-stop/:orderId

POST   /api/orders/chain
GET    /api/orders/chain/:parentTradeId
GET    /api/orders/active

POST   /api/backtest/strategy
GET    /api/backtest/:backtestId/results
```

### New WebSocket Events

```
Chart Events:
  candlestick:1m
  candlestick:5m
  candlestick:15m
  candlestick:1h
  candlestick:4h
  candlestick:1d
  candlestick:1w

Indicator Events:
  indicator:sma
  indicator:ema
  indicator:rsi
  indicator:macd
  indicator:bollinger

Order Events:
  order:created
  order:triggered
  order:executed
  order:canceled

Portfolio Events:
  portfolio:updated
  portfolio:allocation:changed
  pnl:updated
```

---

## 🔄 IMPLEMENTATION SEQUENCE

### Week 1: Core Order Logic

**Day 1-2: Stop-Loss Orders**
- Create `advanced-orders.mjs` module
- Implement `createStopLossOrder()` 
- Implement `checkStopLossTriggered()`
- Implement `executeStopLoss()`
- Write 8 tests

**Day 3: Take-Profit Orders**
- Implement `createTakeProfitOrder()`
- Implement `checkTakeProfitTriggered()`
- Implement `executeTakeProfit()`
- Write 8 tests

**Day 4: Database Migrations**
- Create schema for `advanced_orders` table
- Create schema for `order_chains` table
- Add indexes for performance
- Run migrations on production

**Day 5: Integration & Monitoring**
- Create `monitor-service.mjs` for background polling
- Link to existing matching engine
- Start monitoring service with PM2
- Test end-to-end flow

### Week 2: Trailing Stops & WebSocket

**Day 6-7: Trailing Stops**
- Create `trailing-stop.mjs` module
- Implement trail update logic
- Implement trigger detection
- Write 6 tests
- Integrate with monitor service

**Day 8-9: WebSocket Streaming**
- Create `websocket-streaming.mjs`
- Implement candlestick streaming
- Implement indicator streaming
- Implement order update streaming
- Write 6 tests

**Day 10: Real-Time Integration**
- Connect WebSocket to monitor service
- Stream live updates
- Test with multiple clients
- Performance optimization

### Week 3: Testing & Documentation

**Day 11-12: Integration Testing**
- Write 8 integration test cases
- Test complex scenarios (multi-order chains)
- Test failure modes
- Load testing (100+ concurrent orders)

**Day 13: Documentation**
- Write API reference (PHASE5_ADVANCED_ORDERS.md)
- Write WebSocket guide (PHASE5_WEBSOCKET_GUIDE.md)
- Write deployment guide
- Create postman collection

**Day 14: Production Deployment**
- Deploy to staging
- Run smoke tests
- Deploy to production
- Monitor for 24 hours

---

## 🛠️ TECHNOLOGY STACK

**Existing (Reuse):**
- Express.js (API server)
- Socket.io (WebSocket)
- PostgreSQL (database)
- Redis (caching)
- Prisma (ORM)
- Decimal.js (precision)

**New Libraries:**
- `uuid` - Generate order IDs
- `ws` - WebSocket protocol
- `node-schedule` - Background monitoring tasks
- `joi` - Request validation

---

## ⚡ PERFORMANCE OPTIMIZATION

**Monitoring Service:**
- Poll database every 1 second (configurable)
- Check 1000+ active orders efficiently
- Use database indexes on `status`, `trigger_value`
- Cache recent prices in Redis

**WebSocket Streaming:**
- Publish candles to Redis channel
- Subscribe multiple clients via Redis Pub/Sub
- Broadcast portfolio updates only to relevant user
- Rate limit updates (max 1/second per user)

**Database:**
- Add index on `advanced_orders(user_id, status)`
- Add index on `advanced_orders(market_id, trigger_value)`
- Partition order history by date
- Archive old orders quarterly

---

## 📈 SUCCESS CRITERIA

Phase 5 is complete when:

- ✅ 36+ tests written and passing (100%)
- ✅ Stop-loss orders trigger & execute correctly
- ✅ Take-profit orders trigger & execute correctly
- ✅ Trailing stops adjust dynamically
- ✅ WebSocket streams real-time data
- ✅ Order chains link SL/TP/Trail
- ✅ Ledger records all transactions
- ✅ Portfolio updates in real-time
- ✅ API endpoints fully documented
- ✅ WebSocket events documented
- ✅ Production deployment successful
- ✅ Zero downtime deployment
- ✅ 99%+ uptime
- ✅ <100ms response times

---

## 🚀 PHASE 5B: UI DASHBOARD (Following Phase 5)

After Phase 5 backend is complete:

**React Dashboard Components:**
- Chart component (TradingView Lightweight)
- Portfolio overview
- Order management interface
- Advanced order configuration forms
- Real-time portfolio tracker
- P&L dashboard
- Trading history table
- Alert system

**Timeline:** 1-2 weeks
**Estimate:** 2000+ lines of React code

---

## 🎯 READY TO START?

Architecture: ✅ Complete  
Database Schema: ✅ Designed  
File Structure: ✅ Planned  
Tests: ✅ Outlined  
API Endpoints: ✅ Specified  
Timeline: ✅ Realistic  
Risk Assessment: ✅ Medium  

**Status: READY FOR IMPLEMENTATION** 🚀

Next step: Create database migrations and start implementing Stop-Loss orders.

