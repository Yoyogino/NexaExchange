#!/bin/bash
set -e

# Production instance
PROD_HOST="34.200.205.235"
PROD_USER="ec2-user"
PEM_FILE="/home/$(whoami)/.ssh/Exchange.pem"

echo "🚀 Deploying Phase 2 (Orderbook) to Production..."
echo "==============================================="

# 1. Apply database migration
echo "1️⃣ Applying database migration..."
ssh -i "$PEM_FILE" "$PROD_USER@$PROD_HOST" << 'EOSSH'
cd ~/production
docker exec production-postgres-1 psql -U nexa_migrator -d nexa << 'EOSQL'
-- OrderBook Schema Migration
CREATE TYPE "OrderSide" AS ENUM ('BUY', 'SELL');
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED');
CREATE TYPE "OrderType" AS ENUM ('LIMIT', 'MARKET');

CREATE TABLE "Market" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "symbol" TEXT NOT NULL UNIQUE,
    "isActive" BOOLEAN DEFAULT true,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "marketId" TEXT NOT NULL REFERENCES "Market"("id"),
    "side" "OrderSide" NOT NULL,
    "type" "OrderType" NOT NULL,
    "price" NUMERIC(28,8),
    "quantity" NUMERIC(28,8) NOT NULL,
    "filledAmount" NUMERIC(28,8) DEFAULT 0,
    "status" "OrderStatus" DEFAULT 'PENDING',
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Trade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE,
    "marketId" TEXT NOT NULL REFERENCES "Market"("id"),
    "counterOrderId" TEXT,
    "price" NUMERIC(28,8) NOT NULL,
    "quantity" NUMERIC(28,8) NOT NULL,
    "fee" NUMERIC(28,8) NOT NULL,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "Order_userId_idx" ON "Order"("userId");
CREATE INDEX "Order_marketId_idx" ON "Order"("marketId");
CREATE INDEX "Order_status_idx" ON "Order"("status");
CREATE INDEX "Trade_orderId_idx" ON "Trade"("orderId");
CREATE INDEX "Trade_marketId_idx" ON "Trade"("marketId");

-- Seed BTC/USDT market
INSERT INTO "Market" ("id", "baseCurrency", "quoteCurrency", "symbol", "isActive")
VALUES ('market_btc_usdt', 'BTC', 'USDT', 'BTC/USDT', true)
ON CONFLICT DO NOTHING;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON "Market" TO nexa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Order" TO nexa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Trade" TO nexa_app;
GRANT USAGE ON TYPE "OrderSide" TO nexa_app;
GRANT USAGE ON TYPE "OrderStatus" TO nexa_app;
GRANT USAGE ON TYPE "OrderType" TO nexa_app;
EOSQL
echo "✓ Migration complete!"
EOSSH

# 2. Update app container
echo "2️⃣ Pulling latest code..."
ssh -i "$PEM_FILE" "$PROD_USER@$PROD_HOST" << 'EOSSH'
cd ~/production/app
git fetch origin
git reset --hard origin/main
echo "✓ Code updated!"
EOSSH

# 3. Restart containers
echo "3️⃣ Restarting Docker services..."
ssh -i "$PEM_FILE" "$PROD_USER@$PROD_HOST" << 'EOSSH'
cd ~/production
docker-compose down
docker-compose up -d
sleep 5
docker-compose logs app | head -20
echo "✓ Services restarted!"
EOSSH

# 4. Verify
echo "4️⃣ Verifying deployment..."
curl -k -s https://shopboostlabs.com/api/ready | jq .
curl -k -s https://shopboostlabs.com/api/markets | jq .

echo ""
echo "✅ Phase 2 Deployment Complete!"
echo "New endpoints available:"
echo "  GET  /api/markets              - List active markets"
echo "  GET  /api/orderbook/:symbol    - Get orderbook for symbol"
echo "  POST /api/orders               - Place new order"
echo "  GET  /api/orders?userId=<id>   - Get user orders"
echo "  DEL  /api/orders/:orderId      - Cancel order"
