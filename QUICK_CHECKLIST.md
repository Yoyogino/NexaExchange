# ✅ QUICK DEPLOYMENT CHECKLIST

**Print this and follow along!**

---

## PHASE 4 DEPLOYMENT - STEP BY STEP

### 🔴 BLOCKER 1: Fix GitHub Authentication (2-3 min)

**OPTION A: GitHub Personal Access Token (RECOMMENDED)**

- [ ] Go to: https://github.com/settings/tokens/new
- [ ] Click "Generate new token" → "Generate new token (classic)"
- [ ] Give it a name: "NexaExchange Deployment"
- [ ] Check only: ☑️ repo (full control of private repos)
- [ ] Copy token (looks like: `ghp_abc123...`)
- [ ] Go to PowerShell/Terminal in: `C:\Users\ChittyChatter\Downloads\Crypto Exchange`
- [ ] Run: `git credential-manager delete github.com`
- [ ] Run: `git push -u origin main`
- [ ] When prompted:
  - Username: `Yoyogino`
  - Password: `[paste your token]`
- [ ] Verify: You should see commits being pushed ✅

**OPTION B: SSH Key**

- [ ] Run: `ssh-keygen -t ed25519 -C "yoyogino@github.com"`
- [ ] Go to: https://github.com/settings/ssh/new
- [ ] Add public key
- [ ] Run: `git remote set-url origin git@github.com:Yoyogino/NexaExchange.git`
- [ ] Run: `git push -u origin main` ✅

**OPTION C: Clear & Re-auth**

- [ ] Run: `git remote remove origin`
- [ ] Run: `git remote add origin https://github.com/Yoyogino/NexaExchange.git`
- [ ] Run: `git push -u origin main`
- [ ] When prompted, enter Yoyogino credentials ✅

✅ **CONFIRM: Code pushed to GitHub**

---

### 🔴 BLOCKER 2: Start EC2 Instance (2 min)

- [ ] Go to: https://console.aws.amazon.com/ec2/
- [ ] Look for instance: `i-0c67f4b68a24d2b5f` (IP: 34.200.205.235)
- [ ] Check "Instance State" column
- [ ] If showing "stopped":
  - [ ] Click the instance ID
  - [ ] Click "Instance State" dropdown (top right)
  - [ ] Select "Start Instance"
  - [ ] Wait 30-45 seconds
- [ ] Verify: State now shows "running" ✅
- [ ] Verify: Status checks show "2/2 checks passing" ✅

✅ **CONFIRM: Instance is running**

---

## 🚀 DEPLOYMENT STEPS

### STEP 1: SSH into Production (1 min)

```bash
ssh -i "C:\Users\ChittyChatter\Downloads\Exchange.pem" ec2-user@34.200.205.235
```

- [ ] You should be connected to the server
- [ ] Prompt should show: `[ec2-user@ip-...]`

✅ **CONFIRM: SSH connected**

---

### STEP 2: Navigate & Pull Code (1 min)

```bash
cd ~/production/app
git pull origin main
```

**Expected output:**
```
From github.com:Yoyogino/NexaExchange
   * [new branch]      main       -> origin/main
 + abc1234..def5678 main -> origin/main
Files changed:
   server/candlestick.mjs
   server/charts.mjs
   server/portfolio.mjs
   server/analytics.mjs
```

- [ ] You should see 4+ files listed
- [ ] No errors should appear

✅ **CONFIRM: Code pulled successfully**

---

### STEP 3: Verify Phase 4 Files (1 min)

```bash
ls -la server/candlestick.mjs server/charts.mjs server/portfolio.mjs server/analytics.mjs
```

**Expected output:**
```
-rw-r--r-- 1 ec2-user ec2-user 8420 Sep  4 10:15 server/candlestick.mjs
-rw-r--r-- 1 ec2-user ec2-user 3800 Sep  4 10:15 server/charts.mjs
-rw-r--r-- 1 ec2-user ec2-user 9200 Sep  4 10:15 server/portfolio.mjs
-rw-r--r-- 1 ec2-user ec2-user 4100 Sep  4 10:15 server/analytics.mjs
```

- [ ] All 4 files should exist
- [ ] Sizes should be roughly as shown above

✅ **CONFIRM: All Phase 4 files present**

---

### STEP 4: Install Dependencies (1 min)

```bash
npm install
```

**Expected output:**
```
up to date, audited 85 packages in 2.345s
```

- [ ] Should complete without errors
- [ ] May show "up to date" if already installed

✅ **CONFIRM: Dependencies installed**

---

### STEP 5: Restart Docker Containers (2 min)

```bash
cd ~/production
docker-compose down
docker-compose up -d
```

**Expected output:**
```
Stopping production_app_1 ... done
Removing production_app_1 ... done
Removing network production_default
Creating network production_default
Creating production_db_1 ... done
Creating production_redis_1 ... done
Creating production_app_1 ... done
```

- [ ] No errors should appear
- [ ] Should see containers being created

✅ **CONFIRM: Docker containers restarted**

---

### STEP 6: Wait for Services (1 min)

```bash
sleep 15
docker-compose logs app | head -20
```

**Expected output:**
```
app_1  | Server running on port 3001
app_1  | Database connected
app_1  | Redis connected
app_1  | Phase 4: Charts and Analytics loaded
```

- [ ] Should see "Server running" message
- [ ] No crash or error messages

✅ **CONFIRM: Services started successfully**

---

## ✅ VERIFICATION TESTS

### Test 1: Health Check

```bash
curl -k https://shopboostlabs.com/api/ready | jq .
```

**Expected:**
```json
{
  "status": "ready",
  "database": "ok",
  "redis": "ok"
}
```

- [ ] Response is as shown above

✅ **TEST 1 PASSED**

---

### Test 2: Market Support

```bash
curl -k 'https://shopboostlabs.com/api/charts/supports/BTC%2FUSDT' | jq .
```

**Expected:**
```json
{
  "symbol": "BTC/USDT",
  "supported": true,
  "tradeCount": 5000,
  "timeframes": ["1m", "5m", "15m", "1h", "4h", "1d", "1w"],
  "maxCandleLimit": 500,
  "lastUpdate": "2026-09-04T10:15:00Z"
}
```

- [ ] Contains `"supported": true`
- [ ] Contains all 7 timeframes

✅ **TEST 2 PASSED**

---

### Test 3: Candlesticks

```bash
curl -k 'https://shopboostlabs.com/api/charts/candlesticks/BTC%2FUSDT/1h?limit=5' | jq .
```

**Expected:**
```json
{
  "symbol": "BTC/USDT",
  "timeframe": "1h",
  "data": [
    {
      "timestamp": "2026-09-04T07:00:00Z",
      "open": 40000,
      "high": 40500,
      "low": 39800,
      "close": 40200,
      "volume": 2.5,
      "tradeCount": 2847
    }
  ],
  "count": 1
}
```

- [ ] Has `data` array with OHLC values
- [ ] `count` shows number of candles

✅ **TEST 3 PASSED**

---

### Test 4: Technical Analysis

```bash
curl -k 'https://shopboostlabs.com/api/charts/technical-analysis/BTC%2FUSDT/1h' | jq .
```

**Expected:**
```json
{
  "symbol": "BTC/USDT",
  "timeframe": "1h",
  "timestamp": "2026-09-04T10:00:00Z",
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

- [ ] Has `indicators` object
- [ ] Contains all 5 indicators

✅ **TEST 4 PASSED**

---

### Test 5: Market Statistics

```bash
curl -k 'https://shopboostlabs.com/api/analytics/market-stats/BTC%2FUSDT' | jq .
```

**Expected:**
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

- [ ] Has market statistics
- [ ] Contains volume and fee data

✅ **TEST 5 PASSED**

---

## 🎉 FINAL CHECKS

- [ ] All 5 tests passed
- [ ] No errors in responses
- [ ] All endpoints responding
- [ ] Database healthy
- [ ] Redis healthy

```bash
docker-compose ps
```

Should show:
```
NAME              STATUS
production_app_1  Up 2 minutes
production_db_1   Up 2 minutes
production_redis_1 Up 2 minutes
```

- [ ] All containers running

✅ **ALL CHECKS PASSED**

---

## 🚀 SUCCESS!

**Phase 4 is LIVE in production!**

### What's Now Available:

✅ 10 new API endpoints
✅ 4 Charts endpoints (candlesticks, technical analysis, volume profile, market info)
✅ 6 Analytics endpoints (portfolio, P&L, history, performance, market stats, dashboard)
✅ 5 Technical indicators (SMA, EMA, RSI, MACD, Bollinger Bands)
✅ 7 Timeframes (1m, 5m, 15m, 1h, 4h, 1d, 1w)
✅ Real-time candlestick data
✅ Portfolio tracking
✅ Performance metrics

### Next Steps:

1. **Monitor Production**
   ```bash
   docker-compose logs -f app
   ```

2. **Test with Real Data**
   - Create trades via Phase 2 API
   - Watch candlesticks populate
   - Check indicator calculations

3. **Continue Development**
   - Start Phase 5 (Advanced Orders)
   - Plan Phase 5B UI (React Dashboard)

---

## 📞 TROUBLESHOOTING

**If any test fails:**

1. Check logs:
   ```bash
   docker-compose logs app | tail -50
   ```

2. Restart containers:
   ```bash
   docker-compose restart app
   sleep 5
   ```

3. Rerun tests

4. If still failing, refer to:
   - `MANUAL_DEPLOYMENT.md` (section: Troubleshooting)
   - `PHASE4_DEPLOYMENT.md` (section: Troubleshooting)

---

**Status: DEPLOYMENT COMPLETE** ✅

Estimated total time: ~10-15 minutes  
Difficulty: Easy  
Risk: Low (all code tested)

You've got this! 🚀

