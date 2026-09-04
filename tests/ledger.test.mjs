// Integration tests for the double-entry ledger. Requires a reachable
// Postgres at DATABASE_URL (defaults to the local docker-compose instance).
// Run with: npm run test:ledger  (Docker/Postgres must be running).
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import pg from "pg";
import { ensureAccount, ensureLedgerSchema, fundDemoBalance, getBalances, postEntries, recordAudit, transferWithinUser } from "../server/ledger.mjs";
import { assertIsolatedTestDatabase } from "./helpers/test-database.mjs";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgresql://crypto:crypto@localhost:5432/crypto_exchange" });

test.before(async () => {
  await assertIsolatedTestDatabase(pool);
  await ensureLedgerSchema(pool);
});

test.after(async () => {
  await pool.end();
});

async function makeUser(client) {
  const userId = crypto.randomUUID();
  await client.query("INSERT INTO users (id, email, password_hash) VALUES ($1,$2,$3)", [
    userId,
    `${userId}@example.test`,
    "unused",
  ]);
  return userId;
}

/** Every asset's total across ALL ledger accounts (user + system) must net to zero. */
async function totalAcrossAllAccounts(client, asset) {
  const result = await client.query(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END), 0) AS total
     FROM ledger_entries le
     JOIN ledger_accounts la ON la.id = le.ledger_account_id
     WHERE la.asset = $1`,
    [asset],
  );
  return Number(result.rows[0].total);
}

test("demo funding credits the user and debits the system issuance account equally", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userId = await makeUser(client);
    await fundDemoBalance(client, { userId, asset: "BTC", amount: "1", reason: "test grant" });
    await fundDemoBalance(client, { userId, asset: "USDT", amount: "10000", reason: "test grant" });

    const balances = await getBalances(client, userId);
    const btc = balances.find((b) => b.asset === "BTC");
    const usdt = balances.find((b) => b.asset === "USDT");
    assert.equal(Number(btc.availableBalance), 1);
    assert.equal(Number(usdt.availableBalance), 10000);
    assert.equal(Number(btc.lockedBalance), 0);

    // The ledger-wide invariant: nothing was created or destroyed, only moved.
    assert.equal(await totalAcrossAllAccounts(client, "BTC"), 0);
    assert.equal(await totalAcrossAllAccounts(client, "USDT"), 0);

    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
});

test("database rejects ledger account types with impossible ownership", async () => {
  const client = await pool.connect();
  try {
    const userId = await makeUser(client);
    await client.query("BEGIN");
    await assert.rejects(
      client.query("INSERT INTO ledger_accounts (id,user_id,asset,account_type) VALUES ($1,NULL,'BTC','AVAILABLE')", [crypto.randomUUID()]),
      (error) => error.code === "23514",
    );
    await client.query("ROLLBACK");
    await client.query("BEGIN");
    await assert.rejects(
      client.query("INSERT INTO ledger_accounts (id,user_id,asset,account_type) VALUES ($1,$2,'BTC','FEE')", [crypto.randomUUID(), userId]),
      (error) => error.code === "23514",
    );
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
});

test("posted ledger history and account identities are immutable", async () => {
  const userId = await makeUser(pool);
  await fundDemoBalance(pool, { userId, asset: "BTC", amount: "1", reason: "immutability test" });
  const entry = await pool.query(
    "SELECT le.id,le.ledger_account_id FROM ledger_entries le JOIN ledger_accounts la ON la.id=le.ledger_account_id WHERE la.user_id=$1 LIMIT 1",
    [userId],
  );
  await assert.rejects(
    pool.query("UPDATE ledger_entries SET reason='rewritten' WHERE id=$1", [entry.rows[0].id]),
    (error) => error.code === "55000" && /append-only/.test(error.message),
  );
  await assert.rejects(
    pool.query("DELETE FROM ledger_entries WHERE id=$1", [entry.rows[0].id]),
    (error) => error.code === "55000" && /append-only/.test(error.message),
  );
  await assert.rejects(
    pool.query("UPDATE ledger_accounts SET asset='USDT' WHERE id=$1", [entry.rows[0].ledger_account_id]),
    (error) => error.code === "55000" && /append-only/.test(error.message),
  );
});

test("audit history is immutable after it is recorded", async () => {
  const userId = await makeUser(pool);
  await recordAudit(pool, { actorUserId: userId, action: "security.test", targetType: "user", targetId: userId });
  const event = await pool.query("SELECT id FROM audit_events WHERE actor_user_id=$1 AND action='security.test'", [userId]);
  await assert.rejects(
    pool.query("UPDATE audit_events SET action='rewritten' WHERE id=$1", [event.rows[0].id]),
    (error) => error.code === "55000" && /append-only/.test(error.message),
  );
  await assert.rejects(
    pool.query("DELETE FROM audit_events WHERE id=$1", [event.rows[0].id]),
    (error) => error.code === "55000" && /append-only/.test(error.message),
  );
});

test("transferWithinUser moves funds from available to locked without changing the total", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userId = await makeUser(client);
    await fundDemoBalance(client, { userId, asset: "BTC", amount: "1", reason: "test grant" });

    await transferWithinUser(client, {
      userId,
      asset: "BTC",
      amount: "0.4",
      fromType: "AVAILABLE",
      toType: "LOCKED",
      reason: "order placed",
      relatedType: "order",
      relatedId: "test-order",
    });

    const balances = await getBalances(client, userId);
    const btc = balances.find((b) => b.asset === "BTC");
    assert.equal(Number(btc.availableBalance), 0.6);
    assert.equal(Number(btc.lockedBalance), 0.4);
    assert.equal(Number(btc.availableBalance) + Number(btc.lockedBalance), 1);

    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
});

test("a fresh user with no ledger activity has zero balances for every asset", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userId = await makeUser(client);
    const balances = await getBalances(client, userId);
    assert.equal(balances.length, 2);
    for (const wallet of balances) {
      assert.equal(Number(wallet.availableBalance), 0);
      assert.equal(Number(wallet.lockedBalance), 0);
    }
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
});

test("ledger balancing detects one smallest-unit difference at large values", async () => {
  const client = { query: async () => assert.fail("an unbalanced group must fail before any database write") };
  await assert.rejects(
    () => postEntries(client, [
      { accountId: crypto.randomUUID(), asset: "USDT", direction: "CREDIT", amount: "900719925.47409930", reason: "precision test" },
      { accountId: crypto.randomUUID(), asset: "USDT", direction: "DEBIT", amount: "900719925.47409929", reason: "precision test" },
    ]),
    /off by 0\.00000001/,
  );
});

test("ledger entries cannot disguise an account as a different asset", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userId = await makeUser(client);
    const btcAccount = await ensureAccount(client, { userId, asset: "BTC", accountType: "AVAILABLE" });
    const usdtAccount = await ensureAccount(client, { userId, asset: "USDT", accountType: "AVAILABLE" });
    await assert.rejects(
      () => postEntries(client, [
        { accountId: btcAccount, asset: "BTC", direction: "DEBIT", amount: "1", reason: "asset test" },
        { accountId: usdtAccount, asset: "BTC", direction: "CREDIT", amount: "1", reason: "asset test" },
      ]),
      /belongs to USDT, not BTC/,
    );
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
});

test("concurrent postings cannot spend the same available balance twice", async () => {
  const setup = await pool.connect();
  let userId;
  try {
    await setup.query("BEGIN");
    userId = await makeUser(setup);
    await fundDemoBalance(setup, { userId, asset: "BTC", amount: "1", reason: "concurrency test" });
    await ensureAccount(setup, { userId, asset: "BTC", accountType: "LOCKED" });
    await setup.query("COMMIT");
  } finally {
    setup.release();
  }

  const spend = async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await transferWithinUser(client, { userId, asset: "BTC", amount: "0.75", fromType: "AVAILABLE", toType: "LOCKED", reason: "concurrent spend" });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };

  const results = await Promise.allSettled([spend(), spend()]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason instanceof Error && result.reason.status === 402).length, 1);
  const balances = await getBalances(pool, userId);
  const btc = balances.find((balance) => balance.asset === "BTC");
  assert.equal(btc.availableBalance, "0.25000000");
  assert.equal(btc.lockedBalance, "0.75000000");
});

test("concurrent wallet creation returns one shared ledger account", async () => {
  const setup = await pool.connect();
  let userId;
  try {
    await setup.query("BEGIN");
    userId = await makeUser(setup);
    await setup.query("COMMIT");
  } finally {
    setup.release();
  }

  const createWallet = async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const accountId = await ensureAccount(client, { userId, asset: "USDT", accountType: "LOCKED" });
      await client.query("COMMIT");
      return accountId;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };

  const [first, second] = await Promise.all([createWallet(), createWallet()]);
  assert.equal(first, second);
  const count = await pool.query(
    "SELECT count(*)::int AS count FROM ledger_accounts WHERE user_id=$1 AND asset='USDT' AND account_type='LOCKED'",
    [userId],
  );
  assert.equal(count.rows[0].count, 1);
});
