import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";

const baseUrl = new URL(process.argv[2] || process.env.STAGING_URL);
if (baseUrl.protocol !== "https:") throw new Error("STAGING_URL must use HTTPS.");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const suffix = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
const password = `${crypto.randomBytes(24).toString("base64url")}Aa1!`;
const openOrders = [];
const sessions = [];

function responseCookies(response) {
  const values = response.headers.getSetCookie?.() ?? [];
  return Object.fromEntries(values.map((value) => {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    return [pair.slice(0, separator), pair.slice(separator + 1)];
  }));
}

function cookieHeader(values) {
  return Object.entries(values).map(([name, value]) => `${name}=${value}`).join("; ");
}

async function request(path, { method = "GET", cookies, body, headers = {} } = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookies ? { cookie: cookieHeader(cookies) } : {}),
      ...(cookies?.nexa_csrf && method !== "GET" ? { "x-csrf-token": cookies.nexa_csrf } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, payload, cookies: { ...(cookies ?? {}), ...responseCookies(response) } };
}

async function register(label) {
  const email = `trading-${label}-${suffix}@example.test`;
  const result = await request("/api/auth/register", { method: "POST", body: { email, password } });
  assert.equal(result.response.status, 201, `${label} registration failed with ${result.response.status}.`);
  sessions.push(result.cookies);
  return { email, cookies: result.cookies, account: result.payload };
}

async function order(actor, body, idempotencyKey = crypto.randomUUID()) {
  const result = await request("/api/orders", {
    method: "POST",
    cookies: actor.cookies,
    headers: { "idempotency-key": idempotencyKey },
    body,
  });
  assert.equal(result.response.status, 201, result.payload?.error || `Order failed with ${result.response.status}.`);
  if (["OPEN", "PARTIALLY_FILLED"].includes(result.payload.status)
      && !openOrders.some((entry) => entry.id === result.payload.orderId)) {
    openOrders.push({ actor, id: result.payload.orderId });
  }
  return result.payload;
}

async function cancel(actor, orderId) {
  const result = await request(`/api/orders/${orderId}`, { method: "DELETE", cookies: actor.cookies });
  assert.equal(result.response.status, 200, result.payload?.error || `Cancellation failed with ${result.response.status}.`);
  const tracked = openOrders.findIndex((entry) => entry.id === orderId);
  if (tracked >= 0) openOrders.splice(tracked, 1);
  return result.payload;
}

function wallet(account, asset) {
  const value = account.wallets.find((entry) => entry.asset === asset);
  assert.ok(value, `${asset} wallet was missing.`);
  return value;
}

async function account(actor) {
  const result = await request("/api/me", { cookies: actor.cookies });
  assert.equal(result.response.status, 200);
  actor.cookies = result.cookies;
  return result.payload;
}

try {
  const existing = await pool.query("SELECT count(*)::int AS count FROM orders WHERE status IN ('OPEN','PARTIALLY_FILLED')");
  assert.equal(existing.rows[0].count, 0, "Staging order book is not empty; refusing to disturb existing orders.");

  const seller1 = await register("seller-one");
  const seller2 = await register("seller-two");
  const buyer = await register("buyer");

  const fundingReplay = await request("/api/demo-funding/claim", { method: "POST", cookies: buyer.cookies, body: {} });
  assert.equal(fundingReplay.response.status, 409, "Demo funding was claimable more than once.");

  const firstSell = await order(seller1, { side: "SELL", type: "LIMIT", price: "1000", quantity: "0.2" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const secondSell = await order(seller2, { side: "SELL", type: "LIMIT", price: "1000", quantity: "0.2" });
  const crossingBuy = await order(buyer, { side: "BUY", type: "LIMIT", price: "1000", quantity: "0.3" });

  assert.equal(crossingBuy.status, "FILLED");
  assert.equal(crossingBuy.trades.length, 2);
  const matchedOrders = await pool.query(
    "SELECT id, sell_order_id FROM trades WHERE id = ANY($1::uuid[])",
    [crossingBuy.trades.map((trade) => trade.id)],
  );
  const sellOrderForTrade = new Map(matchedOrders.rows.map((row) => [row.id, row.sell_order_id]));
  assert.equal(sellOrderForTrade.get(crossingBuy.trades[0].id), firstSell.orderId, "Earlier equal-price order did not fill first.");
  assert.equal(sellOrderForTrade.get(crossingBuy.trades[1].id), secondSell.orderId, "Second equal-price order did not receive the partial fill.");
  assert.equal(crossingBuy.trades[0].buyerFee, "0.00040000");
  assert.equal(crossingBuy.trades[0].sellerFee, "0.20000000");
  assert.equal(crossingBuy.trades[1].buyerFee, "0.00020000");
  assert.equal(crossingBuy.trades[1].sellerFee, "0.10000000");

  const seller2BeforeCancel = await account(seller2);
  assert.equal(wallet(seller2BeforeCancel, "BTC").lockedBalance, "0.10000000");
  await cancel(seller2, secondSell.orderId);
  const seller2AfterCancel = await account(seller2);
  assert.equal(wallet(seller2AfterCancel, "BTC").lockedBalance, "0.00000000");
  assert.equal(wallet(seller2AfterCancel, "BTC").availableBalance, "0.90000000");

  const idempotencyKey = crypto.randomUUID();
  const firstReplay = await order(buyer, { side: "BUY", type: "LIMIT", price: "500", quantity: "0.1" }, idempotencyKey);
  const secondReplay = await order(buyer, { side: "BUY", type: "LIMIT", price: "500", quantity: "0.1" }, idempotencyKey);
  assert.equal(secondReplay.orderId, firstReplay.orderId, "Idempotent replay created another order.");
  const replayCount = await pool.query("SELECT count(*)::int AS count FROM orders WHERE id=$1", [firstReplay.orderId]);
  assert.equal(replayCount.rows[0].count, 1);
  await cancel(buyer, firstReplay.orderId);

  const selfSell = await order(buyer, { side: "SELL", type: "LIMIT", price: "900", quantity: "0.1" });
  const selfBuy = await order(buyer, { side: "BUY", type: "LIMIT", price: "900", quantity: "0.1" });
  assert.equal(selfBuy.trades.length, 0, "Self-trade prevention failed.");
  await cancel(buyer, selfSell.orderId);
  await cancel(buyer, selfBuy.orderId);

  const emptyMarket = await order(buyer, { side: "BUY", type: "MARKET", quantity: "0.1" });
  assert.equal(emptyMarket.status, "CANCELLED");
  assert.equal(emptyMarket.filledQuantity, "0.00000000");
  assert.equal(emptyMarket.trades.length, 0);

  const imbalance = await pool.query(`
    SELECT count(*)::int AS count
      FROM (
        SELECT le.group_id, la.asset
          FROM ledger_entries le
          JOIN ledger_accounts la ON la.id = le.ledger_account_id
         GROUP BY le.group_id, la.asset
        HAVING SUM(CASE WHEN le.direction='CREDIT' THEN le.amount ELSE -le.amount END) <> 0
      ) broken
  `);
  assert.equal(imbalance.rows[0].count, 0, "Ledger contains an unbalanced posting group.");

  console.log(JSON.stringify({
    oneTimeFundingPassed: true,
    limitMatchingPassed: true,
    priceTimePriorityPassed: true,
    partialFillPassed: true,
    makerTakerFeesPassed: true,
    exactCancellationUnlockPassed: true,
    idempotencyPassed: true,
    selfTradePreventionPassed: true,
    emptyBookMarketOrderPassed: true,
    ledgerInvariantPassed: true,
  }));
} finally {
  for (const entry of [...openOrders]) {
    await cancel(entry.actor, entry.id).catch(() => {});
  }
  await pool.query(
    `UPDATE sessions
        SET revoked_at=now()
      WHERE user_id IN (
        SELECT id FROM users WHERE email LIKE $1
      ) AND revoked_at IS NULL`,
    [`trading-%-${suffix}@example.test`],
  ).catch(() => {});
  await pool.end();
}
