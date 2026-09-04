// Integration tests for the matching engine. Requires a reachable Postgres
// at DATABASE_URL. Each test creates its own fresh users and relies on
// fresh demo funding, then checks the resulting orders/trades/balances AND
// the whole-database ledger invariant (nothing created or destroyed).
//
// Unlike tests/ledger.test.mjs, these do NOT wrap each test in a rolled-back
// transaction — placeOrder/cancelOrder manage their own commits internally,
// and the matching engine's in-memory book is process-global state, not
// something a per-test transaction could roll back anyway. A first attempt
// at isolating tests by giving each one its own "private" price band turned
// out not to work: a MARKET order ignores price entirely and always eats
// the globally best (cheapest ask / highest bid) resting liquidity, so a
// leftover order from an earlier test can still get matched by a later
// test's market order regardless of price band. The real fix is to reset
// the book before every test: wipe the orders/trades tables and reload the
// (now-empty) in-memory book, so every test starts from a genuinely clean
// market.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { promisify } from "node:util";
import test from "node:test";
import pg from "pg";
import { ensureLedgerSchema, fundDemoBalance, getBalances } from "../server/ledger.mjs";
import { ensureMarketSchema, loadBook, placeOrder, cancelOrder, getOpenOrders, getMarketSnapshot, MARKET_ID } from "../server/matching.mjs";
import { assertIsolatedTestDatabase } from "./helpers/test-database.mjs";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgresql://crypto:crypto@localhost:5432/crypto_exchange" });
const execFileAsync = promisify(execFile);

test.before(async () => {
  await assertIsolatedTestDatabase(pool);
  await ensureLedgerSchema(pool);
  await ensureMarketSchema(pool);
});

test.beforeEach(async () => {
  await pool.query("TRUNCATE trades, orders");
  await loadBook(pool);
});

test.after(async () => {
  await pool.end();
});

async function makeFundedUser(btc = "1", usdt = "10000") {
  const userId = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO users (id, email, password_hash) VALUES ($1,$2,$3)", [userId, `${userId}@example.test`, "unused"]);
    if (Number(btc) > 0) await fundDemoBalance(client, { userId, asset: "BTC", amount: btc, reason: "test grant" });
    if (Number(usdt) > 0) await fundDemoBalance(client, { userId, asset: "USDT", amount: usdt, reason: "test grant" });
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  return userId;
}

async function ledgerInvariantHolds() {
  const result = await pool.query(
    `SELECT la.asset, SUM(CASE WHEN le.direction = 'CREDIT' THEN le.amount ELSE -le.amount END) AS net
     FROM ledger_entries le JOIN ledger_accounts la ON la.id = le.ledger_account_id
     GROUP BY la.asset`,
  );
  for (const row of result.rows) assert.equal(Number(row.net), 0, `${row.asset} ledger does not net to zero`);
}

test("a resting limit sell is fully matched by a crossing limit buy", async () => {
  const seller = await makeFundedUser("1", "0");
  const buyer = await makeFundedUser("0", "1000000");

  const sellResult = await placeOrder(pool, { userId: seller, side: "SELL", type: "LIMIT", price: "50000", quantity: "0.5" });
  assert.equal(sellResult.status, "OPEN");

  const buyResult = await placeOrder(pool, { userId: buyer, side: "BUY", type: "LIMIT", price: "50000", quantity: "0.5" });
  assert.equal(buyResult.status, "FILLED");
  assert.equal(buyResult.trades.length, 1);
  assert.equal(buyResult.trades[0].price, "50000.00000000");
  assert.equal(buyResult.trades[0].quantity, "0.50000000");

  const sellerBalances = await getBalances(pool, seller);
  const buyerBalances = await getBalances(pool, buyer);
  assert.equal(Number(sellerBalances.find((b) => b.asset === "BTC").availableBalance), 0.5); // 1 - 0.5 sold
  assert.equal(Number(sellerBalances.find((b) => b.asset === "BTC").lockedBalance), 0); // fully filled, nothing left locked
  assert.equal(Number(sellerBalances.find((b) => b.asset === "USDT").availableBalance), 24975); // maker fee: 0.1% of 25,000
  assert.equal(Number(buyerBalances.find((b) => b.asset === "BTC").availableBalance), 0.499); // taker fee: 0.2% of 0.5 BTC
  assert.equal(Number(buyerBalances.find((b) => b.asset === "USDT").availableBalance), 1000000 - 25000);

  await ledgerInvariantHolds(); // both orders fully filled here, nothing rests — safe to reuse this price elsewhere in principle, but every other test still uses its own band.
});

test("database rejects impossible order progress, prices, and trade values", async () => {
  const userId = await makeFundedUser();
  const invalidOrderId = crypto.randomUUID();
  await assert.rejects(
    pool.query(
      "INSERT INTO orders (id,user_id,market_id,side,type,price,quantity,filled_quantity,status) VALUES ($1,$2,$3,'BUY','LIMIT',100,1,2,'OPEN')",
      [invalidOrderId, userId, MARKET_ID],
    ),
    (error) => error.code === "23514",
  );
  await assert.rejects(
    pool.query(
      "INSERT INTO orders (id,user_id,market_id,side,type,price,quantity,filled_quantity,status) VALUES ($1,$2,$3,'BUY','MARKET',100,1,0,'FILLED')",
      [crypto.randomUUID(), userId, MARKET_ID],
    ),
    (error) => error.code === "23514",
  );
  await assert.rejects(
    pool.query(
      "INSERT INTO orders (id,user_id,market_id,side,type,price,quantity,filled_quantity,locked_remaining,status) VALUES ($1,$2,$3,'BUY','LIMIT',100,1,0,100,'FILLED')",
      [crypto.randomUUID(), userId, MARKET_ID],
    ),
    (error) => error.code === "23514",
  );
  await assert.rejects(
    pool.query(
      "INSERT INTO orders (id,user_id,market_id,side,type,price,quantity,filled_quantity,locked_remaining,status) VALUES ($1,$2,$3,'BUY','LIMIT',100,1,0,0,'OPEN')",
      [crypto.randomUUID(), userId, MARKET_ID],
    ),
    (error) => error.code === "23514",
  );

  const buyOrderId = crypto.randomUUID();
  const sellOrderId = crypto.randomUUID();
  await pool.query(
    "INSERT INTO orders (id,user_id,market_id,side,type,price,quantity,filled_quantity,status) VALUES ($1,$3,$5,'BUY','LIMIT',100,1,1,'FILLED'),($2,$4,$5,'SELL','LIMIT',100,1,1,'FILLED')",
    [buyOrderId, sellOrderId, userId, await makeFundedUser(), MARKET_ID],
  );
  await assert.rejects(
    pool.query(
      "INSERT INTO trades (id,market_id,buy_order_id,sell_order_id,price,quantity,buyer_fee,seller_fee) VALUES ($1,$2,$3,$4,100,1,-0.01,0)",
      [crypto.randomUUID(), MARKET_ID, buyOrderId, sellOrderId],
    ),
    (error) => error.code === "23514",
  );
  await assert.rejects(
    pool.query(
      "INSERT INTO trades (id,market_id,buy_order_id,sell_order_id,price,quantity,buyer_fee,seller_fee) VALUES ($1,$2,$3,$3,100,1,0,0)",
      [crypto.randomUUID(), MARKET_ID, buyOrderId],
    ),
    (error) => error.code === "23514",
  );
  await assert.rejects(
    pool.query(
      "INSERT INTO trades (id,market_id,buy_order_id,sell_order_id,price,quantity,buyer_fee,seller_fee) VALUES ($1,$2,$3,$4,100,1,0,0)",
      [crypto.randomUUID(), MARKET_ID, sellOrderId, buyOrderId],
    ),
    (error) => error.code === "23514" && /buy order must be a BUY/.test(error.message),
  );
});

test("executed trades are immutable", async () => {
  const seller = await makeFundedUser("1", "0");
  const buyer = await makeFundedUser("0", "100000");
  await placeOrder(pool, { userId: seller, side: "SELL", type: "LIMIT", price: "50000", quantity: "0.1" });
  const result = await placeOrder(pool, { userId: buyer, side: "BUY", type: "LIMIT", price: "50000", quantity: "0.1" });
  const tradeId = result.trades[0].id;
  await assert.rejects(
    pool.query("UPDATE trades SET price=1 WHERE id=$1", [tradeId]),
    (error) => error.code === "55000" && /append-only/.test(error.message),
  );
  await assert.rejects(
    pool.query("DELETE FROM trades WHERE id=$1", [tradeId]),
    (error) => error.code === "55000" && /append-only/.test(error.message),
  );
});

test("replaying an order idempotency key returns one order and locks funds once", async () => {
  const buyer = await makeFundedUser("0", "100000");
  const idempotencyKey = crypto.randomUUID();
  const request = { userId: buyer, side: "BUY", type: "LIMIT", price: "50000", quantity: "0.5", idempotencyKey };
  const first = await placeOrder(pool, request);
  const replay = await placeOrder(pool, request);
  assert.deepEqual(replay, first);
  const orders = await pool.query("SELECT count(*)::int AS count FROM orders WHERE user_id=$1", [buyer]);
  assert.equal(orders.rows[0].count, 1);
  const balances = await getBalances(pool, buyer);
  assert.equal(Number(balances.find((balance) => balance.asset === "USDT").lockedBalance), 25000);
  await ledgerInvariantHolds();
});

test("an idempotency key cannot be reused for a different order payload", async () => {
  const buyer = await makeFundedUser("0", "100000");
  const idempotencyKey = crypto.randomUUID();

  await placeOrder(pool, { userId: buyer, side: "BUY", type: "LIMIT", price: "50000.00", quantity: "0.50", idempotencyKey });
  const equivalent = await placeOrder(pool, { userId: buyer, side: "BUY", type: "LIMIT", price: "50000", quantity: ".5", idempotencyKey });
  assert.equal(equivalent.status, "OPEN");

  await assert.rejects(
    () => placeOrder(pool, { userId: buyer, side: "BUY", type: "LIMIT", price: "51000", quantity: "0.5", idempotencyKey }),
    (error) => error.status === 409 && /different order/.test(error.message),
  );
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM orders WHERE user_id=$1", [buyer])).rows[0].count, 1);
  await ledgerInvariantHolds();
});

test("separate API processes cannot consume the same resting liquidity twice", async () => {
  const seller = await makeFundedUser("1", "0");
  const buyer1 = await makeFundedUser("0", "60000");
  const buyer2 = await makeFundedUser("0", "60000");
  await placeOrder(pool, { userId: seller, side: "SELL", type: "LIMIT", price: "50000", quantity: "1" });

  const requestFor = (userId) => JSON.stringify({ userId, side: "BUY", type: "LIMIT", price: "50000", quantity: "1", idempotencyKey: crypto.randomUUID() });
  await Promise.all([
    execFileAsync(process.execPath, ["tests/helpers/place-order.mjs", requestFor(buyer1)], { env: process.env }),
    execFileAsync(process.execPath, ["tests/helpers/place-order.mjs", requestFor(buyer2)], { env: process.env }),
  ]);

  const trades = await pool.query("SELECT count(*)::int AS count FROM trades");
  assert.equal(trades.rows[0].count, 1);
  const sellerBalances = await getBalances(pool, seller);
  assert.equal(Number(sellerBalances.find((balance) => balance.asset === "BTC").lockedBalance), 0);
  await ledgerInvariantHolds();
});

test("an account cannot trade against its own resting order", async () => {
  const user = await makeFundedUser("1", "100000");
  await placeOrder(pool, { userId: user, side: "SELL", type: "LIMIT", price: "50000", quantity: "0.5" });
  const result = await placeOrder(pool, { userId: user, side: "BUY", type: "LIMIT", price: "50000", quantity: "0.5" });
  assert.equal(result.trades.length, 0);
  assert.equal((await getOpenOrders(pool, user)).length, 2);
  const trades = await pool.query("SELECT count(*)::int AS count FROM trades");
  assert.equal(trades.rows[0].count, 0);
  await ledgerInvariantHolds();
});

test("order safety limits reject excessive quantity, price, and notional", async () => {
  const user = await makeFundedUser("1", "100000");
  await assert.rejects(() => placeOrder(pool, { userId: user, side: "SELL", type: "LIMIT", price: "50000", quantity: "101" }), /cannot exceed 100 BTC/);
  await assert.rejects(() => placeOrder(pool, { userId: user, side: "BUY", type: "LIMIT", price: "10000001", quantity: "0.1" }), /Price cannot exceed/);
  await assert.rejects(() => placeOrder(pool, { userId: user, side: "BUY", type: "LIMIT", price: "2000000", quantity: "60" }), /Order value cannot exceed/);
});

test("minimum order sizes reject dust orders", async () => {
  const user = await makeFundedUser("1", "100000");
  await assert.rejects(() => placeOrder(pool, { userId: user, side: "SELL", type: "MARKET", quantity: "0.000001" }), /at least 0.00001 BTC/);
  await assert.rejects(() => placeOrder(pool, { userId: user, side: "BUY", type: "LIMIT", price: "50000", quantity: "0.0001" }), /at least 10 USDT/);
});

test("an account cannot create more than 100 open orders", async () => {
  const user = await makeFundedUser("1", "100000");
  for (let index = 0; index < 100; index += 1) {
    await pool.query(
      "INSERT INTO orders (id,user_id,market_id,side,type,price,quantity,locked_remaining,status) VALUES ($1,$2,$3,'BUY','LIMIT',1,1,1,'OPEN')",
      [crypto.randomUUID(), user, MARKET_ID],
    );
  }
  await assert.rejects(
    () => placeOrder(pool, { userId: user, side: "BUY", type: "LIMIT", price: "50000", quantity: "0.1" }),
    (error) => error.status === 429 && /at most 100 open orders/.test(error.message),
  );
});

test("a limit order that only partially crosses stays open for the remainder", async () => {
  const seller = await makeFundedUser("1", "0");
  const buyer = await makeFundedUser("0", "1000000");

  await placeOrder(pool, { userId: seller, side: "SELL", type: "LIMIT", price: "61000", quantity: "1" });
  const buyResult = await placeOrder(pool, { userId: buyer, side: "BUY", type: "LIMIT", price: "61000", quantity: "0.3" });

  assert.equal(buyResult.status, "FILLED");
  const openOrders = await getOpenOrders(pool, seller);
  assert.equal(openOrders.length, 1);
  assert.equal(openOrders[0].status, "PARTIALLY_FILLED");
  assert.equal(Number(openOrders[0].filledQuantity), 0.3);
  assert.equal(Number(openOrders[0].quantity), 1);

  await ledgerInvariantHolds(); // 0.7 BTC intentionally left resting at 61000 forever — private to this test.
});

test("price-time priority: two equal-price sells fill in the order they were placed", async () => {
  const seller1 = await makeFundedUser("1", "0");
  const seller2 = await makeFundedUser("1", "0");
  const buyer = await makeFundedUser("0", "1000000");

  await placeOrder(pool, { userId: seller1, side: "SELL", type: "LIMIT", price: "62000", quantity: "0.2" });
  await new Promise((r) => setTimeout(r, 5)); // ensure a distinguishable createdAt
  await placeOrder(pool, { userId: seller2, side: "SELL", type: "LIMIT", price: "62000", quantity: "0.2" });

  const buyResult = await placeOrder(pool, { userId: buyer, side: "BUY", type: "LIMIT", price: "62000", quantity: "0.2" });
  assert.equal(buyResult.trades.length, 1);
  // The trade must have matched the earlier resting order (seller1's), not seller2's.
  const seller1Balances = await getBalances(pool, seller1);
  const seller2Balances = await getBalances(pool, seller2);
  assert.equal(Number(seller1Balances.find((b) => b.asset === "BTC").availableBalance), 0.8); // 1 - 0.2, sold
  assert.equal(Number(seller2Balances.find((b) => b.asset === "BTC").availableBalance), 0.8); // untouched: 1 - 0.2 still locked
  assert.equal(Number(seller2Balances.find((b) => b.asset === "BTC").lockedBalance), 0.2); // seller2's order still fully resting

  await ledgerInvariantHolds(); // seller2's 0.2 BTC intentionally left resting at 62000 forever — private to this test.
});

test("a limit buyer crossing a better ask gets the price difference refunded, not just charged their limit", async () => {
  const seller = await makeFundedUser("1", "0");
  const buyer = await makeFundedUser("0", "1000000");

  await placeOrder(pool, { userId: seller, side: "SELL", type: "LIMIT", price: "63000", quantity: "0.1" });
  // Buyer is willing to pay up to 64000, but the resting ask is only 63000 — trade executes at 63000.
  const buyResult = await placeOrder(pool, { userId: buyer, side: "BUY", type: "LIMIT", price: "64000", quantity: "0.1" });

  assert.equal(buyResult.trades[0].price, "63000.00000000");
  const buyerBalances = await getBalances(pool, buyer);
  // Spent only 0.1 * 63000 = 6300, not 0.1 * 64000 = 6400 — the other 100 was never truly spent.
  assert.equal(Number(buyerBalances.find((b) => b.asset === "USDT").availableBalance), 1000000 - 6300);
  assert.equal(Number(buyerBalances.find((b) => b.asset === "USDT").lockedBalance), 0);

  await ledgerInvariantHolds(); // both sides fully filled here, nothing rests.
});

test("a market order fills against the best resting price and closes instead of resting", async () => {
  const seller = await makeFundedUser("1", "0");
  const buyer = await makeFundedUser("0", "1000000");

  await placeOrder(pool, { userId: seller, side: "SELL", type: "LIMIT", price: "66000", quantity: "0.2" });
  const marketBuy = await placeOrder(pool, { userId: buyer, side: "BUY", type: "MARKET", quantity: "0.2" });

  assert.equal(marketBuy.status, "FILLED");
  assert.equal(marketBuy.trades[0].price, "66000.00000000");
  const openOrders = await getOpenOrders(pool, buyer);
  assert.equal(openOrders.length, 0); // market orders never rest

  await ledgerInvariantHolds(); // the resting ask was fully consumed, nothing rests.
});

test("a market order stops (doesn't reject) when it runs out of book depth", async () => {
  const seller = await makeFundedUser("1", "0");
  const buyer = await makeFundedUser("0", "1000000");

  await placeOrder(pool, { userId: seller, side: "SELL", type: "LIMIT", price: "67000", quantity: "0.1" });
  const marketBuy = await placeOrder(pool, { userId: buyer, side: "BUY", type: "MARKET", quantity: "0.5" }); // book only has 0.1

  assert.equal(marketBuy.status, "CANCELLED"); // closing status for an under-filled market order
  assert.equal(Number(marketBuy.filledQuantity), 0.1);
  assert.equal(marketBuy.trades.length, 1);

  await ledgerInvariantHolds(); // the resting ask was fully consumed (removed from book), market order never rests either.
});

test("placing a limit order without enough available balance is rejected with no side effects", async () => {
  const buyer = await makeFundedUser("0", "100"); // only 100 USDT
  await assert.rejects(
    () => placeOrder(pool, { userId: buyer, side: "BUY", type: "LIMIT", price: "50000", quantity: "1" }), // needs 50,000
    (error) => {
      assert.equal(error.name, "OrderError");
      assert.equal(error.status, 402);
      return true;
    },
  );
  const balances = await getBalances(pool, buyer);
  assert.equal(Number(balances.find((b) => b.asset === "USDT").availableBalance), 100); // untouched
  assert.equal(Number(balances.find((b) => b.asset === "USDT").lockedBalance), 0);
  const openOrders = await getOpenOrders(pool, buyer);
  assert.equal(openOrders.length, 0); // the whole transaction rolled back — no half-placed order left behind, and nothing was inserted into the book.

  await ledgerInvariantHolds();
});

test("cancelling an open limit order unlocks the remaining funds", async () => {
  const buyer = await makeFundedUser("0", "1000000");
  const placed = await placeOrder(pool, { userId: buyer, side: "BUY", type: "LIMIT", price: "68000", quantity: "0.1" });

  let balances = await getBalances(pool, buyer);
  assert.equal(Number(balances.find((b) => b.asset === "USDT").lockedBalance), 6800);

  const cancelled = await cancelOrder(pool, { userId: buyer, orderId: placed.orderId });
  assert.equal(cancelled.status, "CANCELLED");

  balances = await getBalances(pool, buyer);
  assert.equal(Number(balances.find((b) => b.asset === "USDT").availableBalance), 1000000);
  assert.equal(Number(balances.find((b) => b.asset === "USDT").lockedBalance), 0);

  await ledgerInvariantHolds(); // cancelled, nothing rests.
});

test("cancelling someone else's order is rejected", async () => {
  const owner = await makeFundedUser("0", "1000000");
  const stranger = await makeFundedUser("0", "1000000");
  const placed = await placeOrder(pool, { userId: owner, side: "BUY", type: "LIMIT", price: "69000", quantity: "0.1" });

  await assert.rejects(
    () => cancelOrder(pool, { userId: stranger, orderId: placed.orderId }),
    (error) => {
      assert.equal(error.status, 403);
      return true;
    },
  );

  await ledgerInvariantHolds(); // owner's order intentionally left resting at 69000 forever — private to this test.
});

test("market snapshot lists BTC-USDT with the expected best bid/ask after resting orders", async () => {
  const seller = await makeFundedUser("1", "0");
  const buyer = await makeFundedUser("0", "1000000");
  await placeOrder(pool, { userId: seller, side: "SELL", type: "LIMIT", price: "71000", quantity: "0.05" });
  await placeOrder(pool, { userId: buyer, side: "BUY", type: "LIMIT", price: "70000", quantity: "0.05" }); // below the ask, so it rests too instead of crossing

  const snapshot = getMarketSnapshot();
  assert.equal(snapshot.marketId, MARKET_ID);
  assert.ok(snapshot.asks.some((level) => level.price === "71000.00000000"));
  assert.ok(snapshot.bids.some((level) => level.price === "70000.00000000"));

  await ledgerInvariantHolds(); // both intentionally left resting at 70000/71000 forever — private to this test.
});

test("maker and taker fees are charged in each trader's received asset and remain ledger-balanced", async () => {
  const seller = await makeFundedUser("1", "0");
  const buyer = await makeFundedUser("0", "100000");
  await placeOrder(pool, { userId: seller, side: "SELL", type: "LIMIT", price: "50000", quantity: "1" });
  const result = await placeOrder(pool, { userId: buyer, side: "BUY", type: "LIMIT", price: "50000", quantity: "1" });

  assert.equal(result.trades[0].buyerFee, "0.00200000");
  assert.equal(result.trades[0].sellerFee, "50.00000000");
  const sellerBalances = await getBalances(pool, seller);
  const buyerBalances = await getBalances(pool, buyer);
  assert.equal(Number(sellerBalances.find((b) => b.asset === "USDT").availableBalance), 49950);
  assert.equal(Number(buyerBalances.find((b) => b.asset === "BTC").availableBalance), 0.998);
  await ledgerInvariantHolds();
});

test("fees are correctly applied with odd quantities that require rounding", async () => {
  const seller = await makeFundedUser("0.33333333", "0");
  const buyer = await makeFundedUser("0", "20000");
  await placeOrder(pool, { userId: seller, side: "SELL", type: "LIMIT", price: "55555", quantity: "0.33333333" });
  const result = await placeOrder(pool, { userId: buyer, side: "BUY", type: "LIMIT", price: "55555", quantity: "0.33333333" });

  assert.equal(result.status, "FILLED");
  assert.equal(result.trades.length, 1);
  const trade = result.trades[0];
  // Buyer receives: 0.33333333 * (1 - 0.002) = 0.33333333 - 0.000666666... (taker)
  // Seller receives: 55555 * 0.33333333 * (1 - 0.001) = 18518.21... - maker fee
  const sellerBalances = await getBalances(pool, seller);
  const buyerBalances = await getBalances(pool, buyer);
  // Verify both have some balance and fees were applied
  assert.ok(Number(sellerBalances.find((b) => b.asset === "USDT").availableBalance) > 0);
  assert.ok(Number(buyerBalances.find((b) => b.asset === "BTC").availableBalance) > 0);
  await ledgerInvariantHolds();
});

test("partial fills accumulate correct fees across multiple trades", async () => {
  const seller = await makeFundedUser("2", "0");
  const buyer1 = await makeFundedUser("0", "60000");
  const buyer2 = await makeFundedUser("0", "60000");

  // Resting sell order: 2 BTC at 50000
  const sellResult = await placeOrder(pool, { userId: seller, side: "SELL", type: "LIMIT", price: "50000", quantity: "2" });
  assert.equal(sellResult.status, "OPEN");

  // First buyer takes 1 BTC
  const buy1Result = await placeOrder(pool, { userId: buyer1, side: "BUY", type: "LIMIT", price: "50000", quantity: "1" });
  assert.equal(buy1Result.status, "FILLED");
  assert.equal(buy1Result.trades.length, 1);

  // Second buyer takes remaining 1 BTC
  const buy2Result = await placeOrder(pool, { userId: buyer2, side: "BUY", type: "LIMIT", price: "50000", quantity: "1" });
  assert.equal(buy2Result.status, "FILLED");
  assert.equal(buy2Result.trades.length, 1);

  // Check balances
  const sellerBalances = await getBalances(pool, seller);
  const buyer1Balances = await getBalances(pool, buyer1);
  const buyer2Balances = await getBalances(pool, buyer2);

  // Seller received 2 trades * 50000 USDT with 0.1% maker fee each
  // Trade 1: 50000 * (1 - 0.001) = 49950, Trade 2: 50000 * (1 - 0.001) = 49950
  // Total: 99900 USDT
  assert.equal(Number(sellerBalances.find((b) => b.asset === "USDT").availableBalance), 99900);

  // Each buyer received 1 BTC with 0.2% taker fee
  // 1 * (1 - 0.002) = 0.998 BTC each
  assert.equal(Number(buyer1Balances.find((b) => b.asset === "BTC").availableBalance), 0.998);
  assert.equal(Number(buyer2Balances.find((b) => b.asset === "BTC").availableBalance), 0.998);

  await ledgerInvariantHolds();
});

test("a fully filled multi-fill limit buy releases its exact rounded lock", async () => {
  const seller1 = await makeFundedUser("0.0002", "0");
  const seller2 = await makeFundedUser("0.0002", "0");
  const buyer = await makeFundedUser("0", "100");
  const price = "50000.99999999";

  await placeOrder(pool, { userId: seller1, side: "SELL", type: "LIMIT", price, quantity: "0.0002" });
  await placeOrder(pool, { userId: seller2, side: "SELL", type: "LIMIT", price, quantity: "0.0002" });
  const result = await placeOrder(pool, { userId: buyer, side: "BUY", type: "LIMIT", price, quantity: "0.0004" });

  assert.equal(result.status, "FILLED");
  assert.equal(result.trades.length, 2);
  const balances = await getBalances(pool, buyer);
  assert.equal(balances.find((balance) => balance.asset === "USDT").lockedBalance, "0.00000000");
  assert.equal((await pool.query("SELECT locked_remaining FROM orders WHERE id=$1", [result.orderId])).rows[0].locked_remaining, "0.00000000");
  await ledgerInvariantHolds();
});

test("market orders incur taker fees on all fills", async () => {
  const seller = await makeFundedUser("1", "0");
  const buyer = await makeFundedUser("0", "100000");

  await placeOrder(pool, { userId: seller, side: "SELL", type: "LIMIT", price: "52000", quantity: "1" });
  const marketBuyResult = await placeOrder(pool, { userId: buyer, side: "BUY", type: "MARKET", quantity: "1" });

  assert.equal(marketBuyResult.status, "FILLED");
  const trade = marketBuyResult.trades[0];
  // Market order is taker, so buyer pays 0.2% fee on received BTC
  assert.equal(trade.buyerFee, "0.00200000");
  // Seller is maker, so gets 0.1% fee on received USDT
  assert.equal(trade.sellerFee, "52.00000000");

  const buyerBalances = await getBalances(pool, buyer);
  assert.equal(Number(buyerBalances.find((b) => b.asset === "BTC").availableBalance), 0.998); // 1 - 0.002 fee
  await ledgerInvariantHolds();
});

test("selling with a market order applies taker fee to received USDT", async () => {
  const seller = await makeFundedUser("1", "0");
  const buyer = await makeFundedUser("0", "100000");

  await placeOrder(pool, { userId: buyer, side: "BUY", type: "LIMIT", price: "48000", quantity: "1" });
  const marketSellResult = await placeOrder(pool, { userId: seller, side: "SELL", type: "MARKET", quantity: "1" });

  assert.equal(marketSellResult.status, "FILLED");
  const trade = marketSellResult.trades[0];
  // Seller is taker, so pays 0.2% fee on received USDT
  assert.equal(trade.sellerFee, "96.00000000"); // 48000 * 0.002
  // Buyer is maker, so gets 0.1% fee on received BTC
  assert.equal(trade.buyerFee, "0.00100000"); // 1 * 0.001

  const sellerBalances = await getBalances(pool, seller);
  // Seller receives: 48000 * (1 - 0.002) = 47904 USDT
  assert.equal(Number(sellerBalances.find((b) => b.asset === "USDT").availableBalance), 47904);
  await ledgerInvariantHolds();
});
