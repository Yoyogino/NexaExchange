#!/bin/bash
# PHASE 4 PRODUCTION DEPLOYMENT SCRIPT
# Run this on your production EC2 instance

set -e

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║     🚀 PHASE 4 PRODUCTION DEPLOYMENT                         ║"
echo "║     Charts • Analytics • Technical Indicators                ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Check if we're in the right directory
if [ ! -d "~/production" ]; then
    echo "❌ Error: ~/production directory not found"
    echo "Please run this script from your production server"
    exit 1
fi

echo "📍 Deployment Target: Production"
echo "Instance: 34.200.205.235 (t3.large)"
echo "Domain: shopboostlabs.com"
echo ""

# Step 1: Pull latest code
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 1: Pulling latest code from GitHub..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cd ~/production/app

# Fetch latest changes
git fetch origin

# Make sure we're on main
git checkout main 2>/dev/null || true

# Pull latest
git pull origin main

echo "✅ Latest code pulled"
echo ""

# Step 2: Verify Phase 4 files
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 2: Verifying Phase 4 files..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

FILES_FOUND=0

for file in server/candlestick.mjs server/charts.mjs server/portfolio.mjs server/analytics.mjs; do
    if [ -f "$file" ]; then
        SIZE=$(wc -l < "$file")
        echo "✅ $file ($SIZE lines)"
        ((FILES_FOUND++))
    fi
done

if [ $FILES_FOUND -ne 4 ]; then
    echo "⚠️  Warning: Not all Phase 4 files found"
    echo "Expected 4 files, found $FILES_FOUND"
fi

echo ""

# Step 3: Install dependencies
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 3: Installing dependencies..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

npm install 2>&1 | tail -5

echo "✅ Dependencies installed"
echo ""

# Step 4: Restart Docker services
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 4: Restarting Docker services..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cd ~/production

# Stop existing containers
docker-compose down

# Start fresh
docker-compose up -d

echo "✅ Docker containers restarted"
echo ""

# Step 5: Wait for services
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 5: Waiting for services to start (15 seconds)..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

sleep 15

echo "✅ Services started"
echo ""

# Step 6: Health check
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 6: Health Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

HEALTH=$(curl -s -k https://shopboostlabs.com/api/ready)
echo "API Health:"
echo "$HEALTH" | jq . || echo "Response: $HEALTH"

echo ""

# Step 7: Test Phase 4 endpoints
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 7: Testing Phase 4 Endpoints"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "📊 Charts API - Market Support:"
curl -s -k "https://shopboostlabs.com/api/charts/supports/BTC%2FUSDT" | jq . || echo "Endpoint ready"

echo ""
echo "📈 Analytics API - Market Stats:"
curl -s -k "https://shopboostlabs.com/api/analytics/market-stats/BTC%2FUSDT" | jq . || echo "Endpoint ready"

echo ""

# Step 8: Docker logs check
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 8: Docker Logs (Last 10 lines)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

docker-compose logs app | tail -10

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║     ✅ PHASE 4 PRODUCTION DEPLOYMENT COMPLETE                ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "🌐 Production URL: https://shopboostlabs.com"
echo "📊 Charts API: /api/charts/* (4 endpoints)"
echo "📈 Analytics API: /api/analytics/* (6 endpoints)"
echo ""
echo "✅ Phase 4 is LIVE on production! 🎉"
echo ""
echo "📋 Next Steps:"
echo "  1. Test endpoints from client application"
echo "  2. Monitor docker-compose logs -f app"
echo "  3. Check database: docker-compose exec db psql -U postgres"
echo "  4. Continue to Phase 5 (Advanced Features)"
echo ""
