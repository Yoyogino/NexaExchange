# Phase 2: Orderbook API Documentation

## Overview
Phase 2 adds a complete orderbook and order matching engine to the Nexa Exchange. Users can now:
- View all active markets
- Browse the orderbook (order depth) for any market
- Place limit and market orders
- View their order history
- Cancel open orders

## API Endpoints

### Markets

#### GET /api/markets
List all active markets.

**Response:**
```json
[
  {
    "id": "market_btc_usdt",
    "symbol": "BTC/USDT",
    "baseCurrency": "BTC",
    "quoteCurrency": "USDT"
  }
]
```

---

### Orderbook

#### GET /api/orderbook/:symbol
Get the current orderbook (bids and asks) for a market.

**Parameters:**
- `symbol` (path): Market symbol, e.g., "BTC/USDT"

**Response:**
```json
{
  "symbol": "BTC/USDT",
  "bids": [
    {
      "price": 40000.00,
      "quantity": "0.5"
    },
    {
      "price": 39900.00,
      "quantity": "1.5"
    }
  ],
  "asks": [
    {
      "price": 40100.00,
      "quantity": "2.0"
    },
    {
      "price": 40200.00,
      "quantity": "1.0"
    }
  ]
}
```

---

### Orders

#### POST /api/orders
Place a new order.

**Request Body:**
```json
{
  "userId": "user_123",
  "symbol": "BTC/USDT",
  "side": "BUY",
  "type": "LIMIT",
  "price": 40000.00,
  "quantity": "0.5"
}
```

**Parameters:**
- `userId` (required): User ID placing the order
- `symbol` (required): Market symbol, e.g., "BTC/USDT"
- `side` (required): "BUY" or "SELL"
- `type` (required): "LIMIT" or "MARKET"
- `price` (conditional): Required for limit orders, ignored for market orders
- `quantity` (required): Amount to trade

**Response:**
```json
{
  "id": "order_abc123",
  "userId": "user_123",
  "marketId": "market_btc_usdt",
  "side": "BUY",
  "type": "LIMIT",
  "price": "40000.00000000",
  "quantity": "0.50000000",
  "filledAmount": "0.00000000",
  "status": "PENDING",
  "createdAt": "2026-09-04T10:50:00.000Z"
}
```

**Status Codes:**
- `201 Created` - Order placed successfully
- `400 Bad Request` - Missing/invalid parameters
- `404 Not Found` - Market does not exist

---

#### GET /api/orders
Get user's orders.

**Query Parameters:**
- `userId` (required): User ID to fetch orders for

**Response:**
```json
[
  {
    "id": "order_abc123",
    "userId": "user_123",
    "marketId": "market_btc_usdt",
    "side": "BUY",
    "type": "LIMIT",
    "price": "40000.00000000",
    "quantity": "0.50000000",
    "filledAmount": "0.50000000",
    "status": "FILLED",
    "createdAt": "2026-09-04T10:50:00.000Z",
    "market": {
      "symbol": "BTC/USDT"
    }
  }
]
```

---

#### DELETE /api/orders/:orderId
Cancel an open order.

**Parameters:**
- `orderId` (path): Order ID to cancel
- `userId` (body): User ID (for authorization)

**Request Body:**
```json
{
  "userId": "user_123"
}
```

**Response:**
```json
{
  "id": "order_abc123",
  "status": "CANCELLED",
  ...
}
```

**Status Codes:**
- `200 OK` - Order cancelled successfully
- `403 Forbidden` - User does not own this order
- `404 Not Found` - Order not found
- `400 Bad Request` - Order is already FILLED or CANCELLED

---

## Order Matching

### How Matching Works

When an order is placed, it immediately matches against existing opposite-side orders:

1. **Buy Orders**: Match against SELL orders, best (lowest) price first
2. **Sell Orders**: Match against BUY orders, best (highest) price first
3. **Pricing**: Taker pays maker's price
4. **Fees**: 0.1% fee charged on the quote asset (USDT)

### Example: BTC/USDT Trade

**Orderbook Before:**
```
BIDS:
  1.0 BTC @ 40,000 USDT

ASKS:
  2.0 BTC @ 40,100 USDT
```

**Action:** New SELL order: 1 BTC @ 40,000

**Result:**
- Sell order matches against the bid
- Trade: 1 BTC @ 40,000 USDT
- Seller receives: 40,000 - 40 (fee) = 39,960 USDT
- Buyer receives: 1 BTC

**Orderbook After:**
```
BIDS:
  (empty)

ASKS:
  2.0 BTC @ 40,100 USDT
```

---

## Fee Structure

- **Trading Fee**: 0.1% of quote amount
- **Applied to**: Both taker and maker sides
- **Payment**: Deducted from quote asset (USDT)
- **Example**: 1 BTC @ 40,000 USDT = 40 USDT fee

---

## Order Statuses

| Status | Meaning |
|--------|---------|
| PENDING | Order placed, waiting for matches |
| PARTIALLY_FILLED | Some quantity matched, remainder open |
| FILLED | All quantity matched and completed |
| CANCELLED | User cancelled the order |

---

## Error Handling

All errors return JSON with error message:

```json
{
  "error": "Market not found"
}
```

**Common Errors:**
- `400 Bad Request`: Missing required fields, invalid parameters
- `403 Forbidden`: Authorization failed
- `404 Not Found`: Resource not found (market, order, user)
- `500 Internal Server Error`: Server error

---

## Testing the API

### 1. Get Markets
```bash
curl https://shopboostlabs.com/api/markets
```

### 2. View Orderbook
```bash
curl https://shopboostlabs.com/api/orderbook/BTC/USDT
```

### 3. Place Buy Order
```bash
curl -X POST https://shopboostlabs.com/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "symbol": "BTC/USDT",
    "side": "BUY",
    "type": "LIMIT",
    "price": 40000,
    "quantity": "0.5"
  }'
```

### 4. Get Your Orders
```bash
curl "https://shopboostlabs.com/api/orders?userId=user_123"
```

### 5. Cancel Order
```bash
curl -X DELETE https://shopboostlabs.com/api/orders/order_abc123 \
  -H "Content-Type: application/json" \
  -d '{"userId": "user_123"}'
```

---

## Database Schema

### Market
```sql
CREATE TABLE "Market" (
  id TEXT PRIMARY KEY,
  baseCurrency TEXT,
  quoteCurrency TEXT,
  symbol TEXT UNIQUE,
  isActive BOOLEAN,
  createdAt TIMESTAMP,
  updatedAt TIMESTAMP
);
```

### Order
```sql
CREATE TABLE "Order" (
  id TEXT PRIMARY KEY,
  userId TEXT REFERENCES "User"(id),
  marketId TEXT REFERENCES "Market"(id),
  side "OrderSide" (BUY | SELL),
  type "OrderType" (LIMIT | MARKET),
  price DECIMAL(28,8),
  quantity DECIMAL(28,8),
  filledAmount DECIMAL(28,8),
  status "OrderStatus" (PENDING | PARTIALLY_FILLED | FILLED | CANCELLED),
  createdAt TIMESTAMP,
  updatedAt TIMESTAMP
);
```

### Trade
```sql
CREATE TABLE "Trade" (
  id TEXT PRIMARY KEY,
  orderId TEXT REFERENCES "Order"(id),
  marketId TEXT REFERENCES "Market"(id),
  counterOrderId TEXT,
  price DECIMAL(28,8),
  quantity DECIMAL(28,8),
  fee DECIMAL(28,8),
  createdAt TIMESTAMP
);
```

---

## Next Steps (Phase 3)

- [ ] Real-time websocket updates for orderbook
- [ ] Market data feeds (CoinGecko/Binance API)
- [ ] Advanced order types (Stop-loss, take-profit)
- [ ] Order history export
- [ ] Trading statistics dashboard
