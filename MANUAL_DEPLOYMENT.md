# Phase 4 Production Deployment - Manual Steps

## 🚀 Quick Summary

Phase 4 (Charts, Analytics, Technical Indicators) is ready to deploy to production.

**Current Status:** Code pushed to GitHub, ready for deployment  
**Blocker:** EC2 instance connectivity (may need manual restart)  
**Time to Deploy:** ~10 minutes  

---

## 📋 Prerequisites

Before deploying, ensure:

- [ ] EC2 instance is running (34.200.205.235)
- [ ] SSH access to instance works
- [ ] Git repository is cloned in ~/production/app
- [ ] Docker & Docker Compose installed on instance

---

## 🔧 Step-by-Step Deployment

### Step 1: Start EC2 Instance (If Stopped)

1. Go to: https://console.aws.amazon.com/ec2/
2. Find instance: **i-0c67f4b68a24d2b5f** (34.200.205.235)
3. Check **Instance State** in the bottom panel
4. If showing "stopped":
   - Click the state dropdown
   - Select "Start Instance"
   - Wait 30 seconds for boot
5. Verify state is now "running"

### Step 2: SSH into Production Server

```bash
ssh -i Exchange.pem ec2-user@34.200.205.235
```

**Expected:** Should login without password

### Step 3: Navigate to App Directory

```bash
cd ~/production/app
```

### Step 4: Pull Latest Code

```bash
git pull origin main
```

**Expected Output:**
```
   * [new branch]      main       -> origin/main
 + <commit_hash> (commit message)
   
Files changed:
   server/candlestick.mjs
   server/charts.mjs
   server/portfolio.mjs
   server/analytics.mjs
   tests/phase4-charts-analytics.test.mjs
   docs/PHASE4_CHARTS_ANALYTICS.md
```

### Step 5: Verify Phase 4 Files

```bash
ls -la server/candlestick.mjs server/charts.mjs server/portfolio.mjs server/analytics.mjs
```

**Expected:** All 4 files should exist

### Step 6: Install Dependencies

```bash
npm install
```

This will install `decimal.js` if not already present.

### Step 7: Stop Old Containers

```bash
cd ~/production
docker-compose down
```

### Step 8: Start New Containers

```bash
docker-compose up -d
```

### Step 9: Wait for Services

```bash
sleep 15
docker-compose logs app
```

**Look for:** "Server running on port" or similar startup message

### Step 10: Test Phase 4 Deployment

#### Test 1: Health Check

```bash
curl -k https://shopboostlabs.com/api/ready
```

**Expected Response:**
```json
{
  "status": "ready",
  "database": "ok",
  "redis": "ok"
}
```

#### Test 2: Charts API

```bash
curl -k 'https://shopboostlabs.com/api/charts/supports/BTC%2FUSDT' | jq .
```

**Expected Response:**
```json
{
  "symbol": "BTC/USDT",
  "supported": true,
  "tradeCount": 5000,
  "timeframes": ["1m", "5m", "15m", "1h", "4h", "1d", "1w"],
  "maxCandleLimit": 500,
  "lastUpdate": "2026-09-04T07:15:00Z"
}
```

#### Test 3: Candlesticks

```bash
curl -k 'https://shopboostlabs.com/api/charts/candlesticks/BTC%2FUSDT/1h?limit=5' | jq .
```

**Expected Response:**
```json
{
  "symbol": "BTC/USDT",
  "timeframe": "1h",
  "data": [
    {
      "timestamp": "2026-09-04T00:00:00Z",
      "open": 40000,
      "high": 40500,
      "low": 39800,
      "close": 40200,
      "volume": 125.5,
      "tradeCount": 2847
    }
  ],
  "count": 5
}
```

#### Test 4: Technical Analysis

```bash
curl -k 'https://shopboostlabs.com/api/charts/technical-analysis/BTC%2FUSDT/1h' | jq .
```

**Expected Response:**
```json
{
  "symbol": "BTC/USDT",
  "timeframe": "1h",
  "timestamp": "2026-09-04T07:00:00Z",
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
    "macd": {...},
    "bollinger20": {...}
  }
}
```

#### Test 5: Analytics API

```bash
curl -k 'https://shopboostlabs.com/api/analytics/market-stats/BTC%2FUSDT' | jq .
```

**Expected Response:**
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

## ✅ Deployment Verification Checklist

After completing all steps, verify:

- [ ] Health check returns `"status": "ready"`
- [ ] Database status is `"ok"`
- [ ] Redis status is `"ok"`
- [ ] Charts API responds with candlestick data
- [ ] Technical analysis returns indicators
- [ ] Analytics API returns market stats
- [ ] No errors in docker logs
- [ ] Portfolio & history endpoints ready (need auth token)

---

## 🆘 Troubleshooting

### Issue: "Connection refused" on SSH

**Solution:**
1. Instance may be stopped - start it in AWS Console
2. Wait 30 seconds after starting
3. Try SSH again
4. Check security group allows port 22

### Issue: "git pull" fails - "not a git repository"

**Solution:**
```bash
cd ~/production/app
git init
git remote add origin https://github.com/Yoyogino/NexaExchange.git
git pull origin main
```

### Issue: "npm install" fails with missing module

**Solution:**
```bash
npm install decimal.js
npm install --save
```

### Issue: "docker-compose: command not found"

**Solution:**
```bash
# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

### Issue: Port already in use

**Solution:**
```bash
docker-compose down --remove-orphans
docker-compose up -d
```

### Issue: Endpoints return 404

**Solution:**
1. Check server started: `docker-compose logs app | head -20`
2. Wait another 5 seconds and retry
3. Check routes were added: `docker-compose exec app grep -n "charts\|analytics" server/index.mjs`

---

## 📝 Automated Deployment Script

Alternatively, run the automated deployment script:

```bash
# Download script (or copy from file)
curl -o deploy-phase4.sh https://raw.githubusercontent.com/Yoyogino/NexaExchange/main/deploy-phase4.sh

# Make executable
chmod +x deploy-phase4.sh

# Run deployment
./deploy-phase4.sh
```

---

## 🎯 Success Criteria

Phase 4 is successfully deployed when:

✅ All 5 endpoint tests pass  
✅ No errors in docker logs  
✅ Database has trade data  
✅ Candlestick data is populated  
✅ Technical indicators calculate correctly  
✅ Portfolio endpoint is available  

---

## 📊 What's Live After Deployment

**Charts API (4 endpoints)**
- `GET /api/charts/candlesticks/:symbol/:timeframe` - OHLC data
- `GET /api/charts/technical-analysis/:symbol/:timeframe` - Indicators
- `GET /api/charts/volume-profile/:symbol` - Volume distribution
- `GET /api/charts/supports/:symbol` - Market info

**Analytics API (6 endpoints)**
- `GET /api/analytics/portfolio` - User portfolio (requires auth)
- `GET /api/analytics/pnl` - Profit & Loss (requires auth)
- `GET /api/analytics/history` - Trading history (requires auth)
- `GET /api/analytics/performance` - Performance metrics (requires auth)
- `GET /api/analytics/market-stats/:symbol` - Market statistics (public)
- `GET /api/analytics/dashboard` - Combined view (requires auth)

---

## 🚀 Next Steps After Deployment

1. **Monitor Production**
   ```bash
   docker-compose logs -f app
   ```

2. **Test with Real Data**
   - Create trades via Phase 2 orderbook API
   - Verify candlesticks populate
   - Check indicators calculate

3. **Continue Development**
   - Start Phase 5 (Advanced Features)
   - Build Phase 5B UI (React Dashboard)

4. **Performance Optimization**
   - Monitor database query times
   - Add Redis caching for candles
   - Optimize indicator calculations

---

**Deployment Status: READY TO DEPLOY** ✅

All code is tested, documented, and pushed to GitHub. Once instance is accessible, deployment takes ~10 minutes.

For questions, refer to:
- `docs/PHASE4_CHARTS_ANALYTICS.md` - API reference
- `PHASE4_DEPLOYMENT.md` - Detailed deployment guide
- `PHASE4_COMPLETION_REPORT.md` - Implementation summary
