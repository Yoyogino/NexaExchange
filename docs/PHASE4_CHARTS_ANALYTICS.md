# Phase 4: Charts, Analytics & Trading Insights

## Overview

Phase 4 provides **real-time charting, technical analysis, and portfolio insights** to traders. This enables data-driven trading decisions with professional-grade analytics.

### Key Features

✅ **Candlestick Charts** (1m, 5m, 15m, 1h, 4h, 1d, 1w)  
✅ **Technical Indicators** (SMA, EMA, RSI, MACD, Bollinger Bands)  
✅ **Portfolio Tracking** (Value, allocation, P&L)  
✅ **Trading Analytics** (Performance, history, market stats)  
✅ **Volume Analysis** (Price levels, volume profile)  

---

## 1. Charts API

### Get Candlesticks

```bash
GET /api/charts/candlesticks/:symbol/:timeframe?limit=100
```

**Parameters:**
- `symbol`: Market symbol (BTC/USDT, ETH/USDT)
- `timeframe`: 1m, 5m, 15m, 1h, 4h, 1d, 1w
- `limit`: 1-500 candles (default 100)

**Response:**
```json
{
  "symbol": "BTC/USDT",
  "timeframe": "1h",
  "data": [
    {
      "timestamp": "2024-01-15T12:00:00Z",
      "open": 40000,
      "high": 40500,
      "low": 39800,
      "close": 40200,
      "volume": 2.5,
      "tradeCount": 45
    }
  ],
  "count": 100
}
```

### Get Technical Analysis

```bash
GET /api/charts/technical-analysis/:symbol/:timeframe
```

**Response:**
```json
{
  "symbol": "BTC/USDT",
  "timeframe": "1h",
  "timestamp": "2024-01-15T12:00:00Z",
  "open": 40000,
  "high": 40500,
  "low": 39800,
  "close": 40200,
  "volume": 2.5,
  "indicators": {
    "sma20": 40150.50,
    "sma50": 40075.25,
    "ema12": 40200.10,
    "ema26": 40100.05,
    "rsi14": 65.5,
    "macd": {
      "macd": 100.05,
      "signal": 98.50,
      "histogram": 1.55
    },
    "bollinger20": {
      "upper": 40500.00,
      "middle": 40200.00,
      "lower": 39900.00
    }
  }
}
```

### Get Volume Profile

```bash
GET /api/charts/volume-profile/:symbol?buckets=50
```

**Response:**
```json
{
  "symbol": "BTC/USDT",
  "buckets": 50,
  "data": [
    {
      "priceLevel": 39800.00,
      "volumeCount": 125.50
    },
    {
      "priceLevel": 40000.00,
      "volumeCount": 450.75
    }
  ],
  "count": 25
}
```

### Get Market Support

```bash
GET /api/charts/supports/:symbol
```

**Response:**
```json
{
  "symbol": "BTC/USDT",
  "supported": true,
  "tradeCount": 5000,
  "timeframes": ["1m", "5m", "15m", "1h", "4h", "1d", "1w"],
  "maxCandleLimit": 500,
  "lastUpdate": "2024-01-15T12:05:00Z"
}
```

---

## 2. Analytics API

### User Portfolio

```bash
GET /api/analytics/portfolio
Authorization: Bearer {token}
```

**Response:**
```json
{
  "userId": "user123",
  "totalUSD": "50000.00",
  "wallets": 2,
  "breakdown": {
    "BTC": {
      "balance": "1.5",
      "price": 40000,
      "usdValue": "60000.00"
    },
    "USDT": {
      "balance": "5000",
      "price": 1,
      "usdValue": "5000.00"
    }
  },
  "allocation": {
    "BTC": "92.31",
    "USDT": "7.69"
  }
}
```

### Trading History

```bash
GET /api/analytics/history?symbol=BTC/USDT&side=BUY&status=FILLED&limit=50
Authorization: Bearer {token}
```

**Response:**
```json
{
  "count": 50,
  "trades": [
    {
      "orderId": "ord123",
      "symbol": "BTC/USDT",
      "side": "BUY",
      "type": "LIMIT",
      "price": "40000",
      "quantity": "1.0",
      "filledAmount": "1.0",
      "status": "FILLED",
      "trades": 1,
      "createdAt": "2024-01-15T10:00:00Z",
      "updatedAt": "2024-01-15T10:00:30Z"
    }
  ]
}
```

### Trading Performance

```bash
GET /api/analytics/performance
Authorization: Bearer {token}
```

**Response:**
```json
{
  "userId": "user123",
  "dailyTrades": 15,
  "weeklyTrades": 87,
  "monthlyTrades": 245,
  "totalTrades": 1200,
  "totalVolume": "50.12345678",
  "totalFees": "500.00",
  "averageTradeSize": "0.04177046"
}
```

### P&L Summary

```bash
GET /api/analytics/pnl
Authorization: Bearer {token}
```

**Response:**
```json
{
  "userId": "user123",
  "totalPnL": 2500.50,
  "filledOrders": 120,
  "openOrders": 5,
  "winRate": "65.00"
}
```

### Dashboard (Combined)

```bash
GET /api/analytics/dashboard
Authorization: Bearer {token}
```

Returns combined portfolio, P&L, and performance data.

### Market Stats

```bash
GET /api/analytics/market-stats/:symbol
```

**Response:**
```json
{
  "symbol": "BTC/USDT",
  "trades": 5000,
  "volume": "125.50000000",
  "fees": "1255.00",
  "priceHigh": "42000.00",
  "priceLow": "38000.00",
  "lastPrice": "40200.00",
  "avgPrice": "40150.50"
}
```

---

## 3. Technical Indicators

### SMA (Simple Moving Average)

Calculates average price over N periods.

```javascript
import { calculateSMA } from './candlestick.mjs';

const prices = [100, 102, 101, 103, 104];
const sma20 = calculateSMA(prices, 20);
```

**Use Case:** Trend identification, support/resistance

### EMA (Exponential Moving Average)

Weighted average giving more weight to recent prices.

```javascript
const ema12 = calculateEMA(prices, 12);
const ema26 = calculateEMA(prices, 26);
```

**Use Case:** Faster trend detection, momentum trading

### RSI (Relative Strength Index)

Measures momentum (0-100). >70 = overbought, <30 = oversold.

```javascript
const rsi = calculateRSI(prices, 14);
```

**Use Case:** Trend reversal signals, overbought/oversold conditions

### MACD (Moving Average Convergence Divergence)

Trend-following momentum indicator.

```javascript
const macd = calculateMACD(prices);
// Returns: { macd, signal, histogram }
```

**Use Case:** Trend confirmation, divergence signals

### Bollinger Bands

Volatility bands around SMA.

```javascript
const bands = calculateBollingerBands(prices, 20, 2);
// Returns: { upper, middle, lower }
```

**Use Case:** Volatility measurement, mean reversion

---

## 4. Volume Analysis

### Volume Profile

Identifies significant price levels by volume concentration.

```javascript
import { calculateVolumeProfile } from './candlestick.mjs';

const profile = await calculateVolumeProfile(marketId, 50);
// Returns: [{ priceLevel, volumeCount }, ...]
```

**Features:**
- Automatic price bucketing
- Volume aggregation
- Support/resistance identification

---

## 5. Implementation Guide

### Integration into Main Server

```javascript
// server/index.mjs
import chartsRouter from './charts.mjs';
import analyticsRouter from './analytics.mjs';

app.use('/api/charts', chartsRouter);
app.use('/api/analytics', analyticsRouter);
```

### Required Dependencies

```json
{
  "decimal.js": "^10.4.3"
}
```

### Database Considerations

- **Trade queries**: Index on `(marketId, createdAt)` for fast candlestick generation
- **Large datasets**: Use pagination for historical data (>10k candles)
- **Real-time updates**: Cache recent candlesticks, update every minute

---

## 6. Performance Considerations

### Candlestick Generation

- **1m timeframe**: 1440 periods/day → ~500KB per market
- **1d timeframe**: 365 periods/year → ~50KB per market
- **Recommendation**: Cache recent 500 candles, query DB for historical

### Indicator Calculations

- **SMA/EMA**: O(n) per calculation
- **RSI/MACD**: O(n) per calculation
- **Bollinger Bands**: O(n) per calculation
- **Total**: <100ms for 500 price points

### Optimization Tips

1. **Pre-calculate indicators** on candle close
2. **Store in Redis** for <10ms response time
3. **Stream updates** via WebSocket for real-time
4. **Batch queries** for multiple symbols

---

## 7. Testing

Run the comprehensive test suite:

```bash
npm test tests/phase4-charts-analytics.test.mjs
```

**Coverage:**
- ✅ SMA/EMA calculation
- ✅ RSI boundary conditions
- ✅ MACD convergence
- ✅ Bollinger Bands
- ✅ Portfolio calculations
- ✅ Edge cases (tiny/huge prices)
- ✅ Error handling

---

## 8. Security & Permissions

### Authentication Required

- `/api/analytics/portfolio` - Must be own user
- `/api/analytics/history` - Must be own user
- `/api/analytics/performance` - Must be own user
- `/api/analytics/pnl` - Must be own user

### Public Endpoints

- `/api/charts/candlesticks/:symbol/:timeframe`
- `/api/charts/volume-profile/:symbol`
- `/api/charts/technical-analysis/:symbol/:timeframe`
- `/api/analytics/market-stats/:symbol`

---

## 9. Deployment

### Environment Variables

```env
# Optional: Cache TTL for candles (seconds)
CANDLESTICK_CACHE_TTL=300

# Optional: Max candles to generate
MAX_CANDLES_LIMIT=500
```

### Database Migration

No schema changes required. Uses existing `Trade` and `Order` tables.

### Monitoring

```bash
# Monitor query times
SELECT query, mean_time FROM pg_stat_statements WHERE query LIKE '%trade%';

# Monitor cache hit rate
INFO stats  # In Redis
```

---

## 10. Known Limitations & Future Work

### Current Limitations

- Single-candle aggregation (no real-time streaming)
- Volume profile limited to 200 buckets
- Technical indicators on demand (not pre-calculated)
- P&L calculation simplified (doesn't match complex strategies)

### Phase 5 Enhancements

- [ ] Real-time candle streaming via WebSocket
- [ ] Pre-calculated indicators stored in DB
- [ ] Advanced order types (stop-loss, take-profit)
- [ ] Portfolio notifications & alerts
- [ ] Mobile push notifications
- [ ] Drawing tools & annotations

---

## Success Criteria ✅

- [x] Candlestick generation for all timeframes
- [x] All 5 technical indicators working
- [x] Portfolio tracking implemented
- [x] Analytics API complete
- [x] Comprehensive test coverage
- [x] Production-ready error handling
- [x] Documentation & examples

**Status: PHASE 4 READY FOR PRODUCTION** 🚀
