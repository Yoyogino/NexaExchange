// Integration tests for the admin milestone: ledger-backed balance
// adjustments, market pause/resume, and per-user trading disable. Same
// conventions as tests/matching.test.mjs — real Postgres, book reset before
// each test, whole-database ledger invariant checked after every test that
// touches money.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import pg from "pg";
import { ensureLedgerSchema, fundDemoBalance, getBalances, adjustBalance, LedgerError } from "../server/ledger.mjs";
import { ensureMarketSchema, loadBook, placeOrder, cancelOrder, setMarketStatus, getMarketStatus, getAllOrders, getAllTrades } from "../server/matching.mjs";
import { assertIsolatedTestDatabase } from "./helpers/test-database.mjs";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgresql://crypto:crypto@localhost:5432/crypto_exchange" });

test.before(async () => {
  await assertIsolatedTestDatabase(pool);
  await ensureLedgerSchema(pool);
  await ensureMarketSchema(pool);
});

test.beforeEach(async () => {
  await pool.query("TRUNCATE trades, orders");
  await pool.query("UPDATE markets SET status = 'ACTIVE'");
  await loadBook(pool);
});

test.after(async () => {
  // Leave the market ACTIVE for any other test file that runs against the
  // same database, and close the pool.
  await pool.query("UPDATE markets SET status = 'ACTIVE'");
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

// --- adjustBalance ----------------------------------------------------

test("adjustBalance credits a user's available balance from system issuance", async () => {
  const userId = await makeFundedUser("0", "0");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await adjustBalance(client, { userId, asset: "USDT", amount: "250", reason: "goodwill credit", actorUserId: "admin" });
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  const balances = await getBalances(pool, userId);
  assert.equal(Number(balances.find((b) => b.asset === "USDT").availableBalance), 250);
  await ledgerInvariantHolds();
});

test("adjustBalance debits a user's available balance back to system issuance", async () => {
  const userId = await makeFundedUser("0", "500");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await adjustBalance(client, { userId, asset: "USDT", amount: "-200", reason: "correction", actorUserId: "admin" });
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  const balances = await getBalances(pool, userId);
  assert.equal(Number(balances.find((b) => b.asset === "USDT").availableBalance), 300);
  await ledgerInvariantHolds();
});

test("adjustBalance refuses to debit more than the user's available balance", async () => {
  const userId = await makeFundedUser("0", "50");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await assert.rejects(
      () => adjustBalance(client, { userId, asset: "USDT", amount: "-500", reason: "oops", actorUserId: "admin" }),
      (error) => {
        assert.ok(error instanceof LedgerError);
        assert.equal(error.status, 402);
        return true;
      },
    );
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
  const balances = await getBalances(pool, userId);
  assert.equal(Number(balances.find((b) => b.asset === "USDT").availableBalance), 50); // untouched
  await ledgerInvariantHolds();
});

test("adjustBalance rejects a zero amount", async () => {
  const userId = await makeFundedUser("0", "50");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await assert.rejects(
      () => adjustBalance(client, { userId, asset: "USDT", amount: "0", reason: "no-op", actorUserId: "admin" }),
      (error) => {
        assert.ok(error instanceof LedgerError);
        return true;
      },
    );
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
});

// --- market pause/resume ------------------------------------------------

test("pausing the market rejects new orders but leaves cancellation available", async () => {
  const trader = await makeFundedUser("1", "1000000");
  const resting = await placeOrder(pool, { userId: trader, side: "SELL", type: "LIMIT", price: "72000", quantity: "0.1" });

  const paused = await setMarketStatus(pool, "PAUSED");
  assert.equal(paused.status, "PAUSED");
  assert.equal(getMarketStatus(), "PAUSED");

  await assert.rejects(
    () => placeOrder(pool, { userId: trader, side: "BUY", type: "LIMIT", price: "72000", quantity: "0.1" }),
    (error) => {
      assert.equal(error.status, 503);
      return true;
    },
  );

  // Cancelling is unaffected by the pause.
  const cancelled = await cancelOrder(pool, { userId: trader, orderId: resting.orderId });
  assert.equal(cancelled.status, "CANCELLED");

  const resumed = await setMarketStatus(pool, "ACTIVE");
  assert.equal(resumed.status, "ACTIVE");
  assert.equal(getMarketStatus(), "ACTIVE");

  // Orders work again after resuming.
  const placedAgain = await placeOrder(pool, { userId: trader, side: "SELL", type: "LIMIT", price: "72000", quantity: "0.1" });
  assert.equal(placedAgain.status, "OPEN");
  await cancelOrder(pool, { userId: trader, orderId: placedAgain.orderId });

  await ledgerInvariantHolds();
});

// --- per-user trading disable --------------------------------------------

test("a user with trading disabled cannot place orders, but can still cancel resting ones", async () => {
  const trader = await makeFundedUser("1", "1000000");
  const resting = await placeOrder(pool, { userId: trader, side: "SELL", type: "LIMIT", price: "73000", quantity: "0.1" });

  await pool.query("UPDATE users SET trading_disabled = true WHERE id = $1", [trader]);

  await assert.rejects(
    () => placeOrder(pool, { userId: trader, side: "BUY", type: "LIMIT", price: "73000", quantity: "0.1" }),
    (error) => {
      assert.equal(error.status, 403);
      return true;
    },
  );

  const cancelled = await cancelOrder(pool, { userId: trader, orderId: resting.orderId });
  assert.equal(cancelled.status, "CANCELLED");

  await pool.query("UPDATE users SET trading_disabled = false WHERE id = $1", [trader]);
  await ledgerInvariantHolds();
});

// --- admin-scoped queries -------------------------------------------------

test("admin cursor queries have matching composite indexes", async () => {
  const result = await pool.query(
    "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ANY($1::text[])",
    [["users_admin_cursor_idx", "audit_events_admin_cursor_idx", "orders_admin_cursor_idx", "orders_admin_status_cursor_idx", "trades_admin_cursor_idx"]],
  );
  assert.deepEqual(
    result.rows.map((row) => row.indexname).sort(),
    ["audit_events_admin_cursor_idx", "orders_admin_cursor_idx", "orders_admin_status_cursor_idx", "trades_admin_cursor_idx", "users_admin_cursor_idx"],
  );
});

test("getAllOrders and getAllTrades see every user's activity, not just one user's", async () => {
  const seller = await makeFundedUser("1", "0");
  const buyer = await makeFundedUser("0", "1000000");
  await placeOrder(pool, { userId: seller, side: "SELL", type: "LIMIT", price: "74000", quantity: "0.2" });
  await placeOrder(pool, { userId: buyer, side: "BUY", type: "LIMIT", price: "74000", quantity: "0.1" });

  const allOrders = await getAllOrders(pool, {});
  assert.ok(allOrders.items.some((o) => o.userId === seller));
  assert.ok(allOrders.items.some((o) => o.userId === buyer));
  assert.ok(allOrders.items.every((o) => typeof o.userEmail === "string"));

  const firstOrderPage = await getAllOrders(pool, { limit: 1 });
  assert.equal(firstOrderPage.items.length, 1);
  assert.equal(firstOrderPage.hasMore, true);
  const secondOrderPage = await getAllOrders(pool, { limit: 1, cursor: firstOrderPage.nextCursor });
  assert.equal(secondOrderPage.items.length, 1);
  assert.notEqual(secondOrderPage.items[0].id, firstOrderPage.items[0].id);

  const openOnly = await getAllOrders(pool, { status: "PARTIALLY_FILLED" });
  assert.ok(openOnly.items.every((o) => o.status === "PARTIALLY_FILLED"));

  const allTrades = await getAllTrades(pool, {});
  assert.equal(allTrades.items.length, 1);
  assert.equal(allTrades.items[0].buyerId, buyer);
  assert.equal(allTrades.items[0].sellerId, seller);

  await ledgerInvariantHolds(); // seller's remaining 0.1 BTC intentionally left resting — private to this test.
});
