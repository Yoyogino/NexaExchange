// Single-market (BTC/USDT) price-time-priority matching engine.
//
// Design notes, because the "why" matters more than the "what" here:
//
// - One market, one Node process, one mutex (`runExclusive`). All order
//   placement and cancellation is serialized through it, so the in-memory
//   order book and the database can never disagree about what's resting.
//   That's a deliberate simplification for a single-instance demo — a real
//   multi-instance exchange would need a different concurrency model
//   entirely (this is called out in PRODUCT_REQUIREMENTS.md's production
//   decision gate).
// - A whole order placement — inserting the order, locking funds, and every
//   resulting trade settlement — happens inside ONE Postgres transaction.
//   Either the order and all its fills land together, or none of it does
//   (PRD: "A trade, its order updates, and its ledger postings must succeed
//   or fail together").
// - LIMIT orders lock funds up front at their limit price and rest in the
//   book if not fully filled. MARKET orders never rest — they take
//   whatever liquidity is available right now, checked against AVAILABLE
//   balance increment-by-increment as they walk the book (documented
//   simplification: a market order that runs out of book depth or funds
//   simply stops there instead of resting or fully rejecting).
// - Trade price is always the resting (maker) order's price. A LIMIT buyer
//   who crosses a better (lower) ask gets the difference refunded from
//   LOCKED back to AVAILABLE in the same settlement — price improvement is
//   real money and the ledger accounts for it, not just the UI.

import crypto from "node:crypto";
import * as D from "./decimal.mjs";
import { ensureAccount, postEntries, transferWithinUser, getBalances } from "./ledger.mjs";
import { cursorPage, decodeCursor } from "./cursor-pagination.mjs";

export const MARKET_ID = "BTC-USDT";
const BASE_ASSET = "BTC";
const QUOTE_ASSET = "USDT";
// Demo fee schedule. The resting order supplies liquidity (maker); the
// incoming order consumes it (taker). Fees are charged in the asset received.
export const MAKER_FEE_RATE = D.parse("0.001"); // 0.10%
export const TAKER_FEE_RATE = D.parse("0.002"); // 0.20%

export class OrderError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "OrderError";
    this.status = status;
  }
}

export async function ensureMarketSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS markets (
      id TEXT PRIMARY KEY,
      base_asset TEXT NOT NULL,
      quote_asset TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id),
      market_id TEXT NOT NULL REFERENCES markets(id),
      side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
      type TEXT NOT NULL CHECK (type IN ('LIMIT','MARKET')),
      price NUMERIC(28,8),
      quantity NUMERIC(28,8) NOT NULL CHECK (quantity > 0),
      filled_quantity NUMERIC(28,8) NOT NULL DEFAULT 0 CHECK (filled_quantity >= 0 AND filled_quantity <= quantity),
      locked_remaining NUMERIC(28,8) NOT NULL DEFAULT 0 CHECK (locked_remaining >= 0),
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PARTIALLY_FILLED','FILLED','CANCELLED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT limit_orders_have_a_price CHECK (type = 'MARKET' OR price IS NOT NULL),
      CONSTRAINT orders_price_matches_type CHECK ((type = 'LIMIT' AND price > 0) OR (type = 'MARKET' AND price IS NULL)),
      CONSTRAINT orders_status_matches_fill CHECK (
        (status = 'OPEN' AND filled_quantity = 0)
        OR (status = 'PARTIALLY_FILLED' AND filled_quantity > 0 AND filled_quantity < quantity)
        OR (status = 'FILLED' AND filled_quantity = quantity)
        OR status = 'CANCELLED'
      ),
      CONSTRAINT orders_lock_state_valid CHECK (
        (type = 'MARKET' AND locked_remaining = 0)
        OR (type = 'LIMIT' AND status IN ('OPEN','PARTIALLY_FILLED') AND locked_remaining > 0)
        OR (type = 'LIMIT' AND status IN ('FILLED','CANCELLED') AND locked_remaining = 0)
      )
    );
    CREATE INDEX IF NOT EXISTS orders_market_status_idx ON orders (market_id, status);
    CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id);
    CREATE INDEX IF NOT EXISTS orders_admin_cursor_idx ON orders (market_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS orders_admin_status_cursor_idx ON orders (market_id, status, created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS trades (
      id UUID PRIMARY KEY,
      market_id TEXT NOT NULL REFERENCES markets(id),
      buy_order_id UUID NOT NULL REFERENCES orders(id),
      sell_order_id UUID NOT NULL REFERENCES orders(id),
      price NUMERIC(28,8) NOT NULL CHECK (price > 0),
      quantity NUMERIC(28,8) NOT NULL CHECK (quantity > 0),
      buyer_fee NUMERIC(28,8) NOT NULL DEFAULT 0 CHECK (buyer_fee >= 0),
      seller_fee NUMERIC(28,8) NOT NULL DEFAULT 0 CHECK (seller_fee >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT trades_distinct_orders CHECK (buy_order_id <> sell_order_id)
    );
    CREATE INDEX IF NOT EXISTS trades_market_idx ON trades (market_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS trades_admin_cursor_idx ON trades (market_id, created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS order_requests (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      idempotency_key UUID NOT NULL,
      request_hash TEXT,
      response JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS order_requests_created_idx ON order_requests (created_at);

    INSERT INTO markets (id, base_asset, quote_asset)
    VALUES ('${MARKET_ID}', '${BASE_ASSET}', '${QUOTE_ASSET}')
    ON CONFLICT (id) DO NOTHING;

    -- Added for the admin milestone: an admin can pause the market (new
    -- orders rejected; cancels still allowed) without touching per-user
    -- state. ALTER is needed for backward compatibility with dev databases
    -- created before this column existed.
    ALTER TABLE markets ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED'));
    ALTER TABLE trades ADD COLUMN IF NOT EXISTS buyer_fee NUMERIC(28,8) NOT NULL DEFAULT 0;
    ALTER TABLE trades ADD COLUMN IF NOT EXISTS seller_fee NUMERIC(28,8) NOT NULL DEFAULT 0;
    ALTER TABLE order_requests ADD COLUMN IF NOT EXISTS request_hash TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS locked_remaining NUMERIC(28,8);
    UPDATE orders SET locked_remaining = CASE
      WHEN type <> 'LIMIT' THEN 0
      WHEN side = 'BUY' THEN (quantity - filled_quantity) * price
      ELSE quantity - filled_quantity
    END WHERE locked_remaining IS NULL;
    ALTER TABLE orders ALTER COLUMN locked_remaining SET DEFAULT 0;
    ALTER TABLE orders ALTER COLUMN locked_remaining SET NOT NULL;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='orders'::regclass AND conname='orders_filled_quantity_valid') THEN
        ALTER TABLE orders ADD CONSTRAINT orders_filled_quantity_valid CHECK (filled_quantity >= 0 AND filled_quantity <= quantity);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='orders'::regclass AND conname='orders_price_matches_type') THEN
        ALTER TABLE orders ADD CONSTRAINT orders_price_matches_type CHECK ((type = 'LIMIT' AND price > 0) OR (type = 'MARKET' AND price IS NULL));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='orders'::regclass AND conname='orders_status_matches_fill') THEN
        ALTER TABLE orders ADD CONSTRAINT orders_status_matches_fill CHECK (
          (status = 'OPEN' AND filled_quantity = 0)
          OR (status = 'PARTIALLY_FILLED' AND filled_quantity > 0 AND filled_quantity < quantity)
          OR (status = 'FILLED' AND filled_quantity = quantity)
          OR status = 'CANCELLED'
        );
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='orders'::regclass AND conname='orders_lock_state_valid') THEN
        ALTER TABLE orders ADD CONSTRAINT orders_lock_state_valid CHECK (
          (type = 'MARKET' AND locked_remaining = 0)
          OR (type = 'LIMIT' AND status IN ('OPEN','PARTIALLY_FILLED') AND locked_remaining > 0)
          OR (type = 'LIMIT' AND status IN ('FILLED','CANCELLED') AND locked_remaining = 0)
        );
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='trades'::regclass AND conname='trades_values_valid') THEN
        ALTER TABLE trades ADD CONSTRAINT trades_values_valid CHECK (price > 0 AND quantity > 0 AND buyer_fee >= 0 AND seller_fee >= 0);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='trades'::regclass AND conname='trades_distinct_orders') THEN
        ALTER TABLE trades ADD CONSTRAINT trades_distinct_orders CHECK (buy_order_id <> sell_order_id);
      END IF;
    END $$;

    CREATE OR REPLACE FUNCTION validate_trade_order_relationships()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM orders
        WHERE id = NEW.buy_order_id AND side = 'BUY' AND market_id = NEW.market_id
      ) THEN
        RAISE EXCEPTION 'trade buy order must be a BUY in the same market' USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM orders
        WHERE id = NEW.sell_order_id AND side = 'SELL' AND market_id = NEW.market_id
      ) THEN
        RAISE EXCEPTION 'trade sell order must be a SELL in the same market' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='trades'::regclass AND tgname='trades_validate_order_relationships') THEN
        CREATE TRIGGER trades_validate_order_relationships
        BEFORE INSERT OR UPDATE OF market_id, buy_order_id, sell_order_id ON trades
        FOR EACH ROW EXECUTE FUNCTION validate_trade_order_relationships();
      END IF;
    END $$;

    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM trades t
        JOIN orders b ON b.id=t.buy_order_id
        JOIN orders s ON s.id=t.sell_order_id
        WHERE b.side <> 'BUY' OR s.side <> 'SELL'
           OR b.market_id <> t.market_id OR s.market_id <> t.market_id
      ) THEN
        RAISE EXCEPTION 'existing trades contain invalid order relationships';
      END IF;
    END $$;

    CREATE OR REPLACE FUNCTION reject_trade_mutation()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'executed trades are append-only' USING ERRCODE = '55000';
    END;
    $$;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='trades'::regclass AND tgname='trades_immutable') THEN
        CREATE TRIGGER trades_immutable
        BEFORE UPDATE OR DELETE ON trades
        FOR EACH ROW EXECUTE FUNCTION reject_trade_mutation();
      END IF;
    END $$;
  `);
}

// --- In-memory order book -------------------------------------------------
// buys: best (highest) price first, ties broken by earliest createdAt.
// sells: best (lowest) price first, ties broken by earliest createdAt.
const book = { buys: [], sells: [] };
// In-memory mirror of markets.status, same rationale as the order book: kept
// in sync with the DB and read without a round trip on every order attempt.
let marketStatus = "ACTIVE";

function sortBook() {
  book.buys.sort((a, b) => (b.price !== a.price ? (b.price > a.price ? 1 : -1) : a.createdAt - b.createdAt));
  book.sells.sort((a, b) => (a.price !== b.price ? (a.price > b.price ? 1 : -1) : a.createdAt - b.createdAt));
}

function insertSorted(side, order) {
  const list = side === "BUY" ? book.buys : book.sells;
  list.push(order);
  sortBook();
}

function removeFromBook(side, orderId) {
  const list = side === "BUY" ? book.buys : book.sells;
  const index = list.findIndex((o) => o.id === orderId);
  if (index !== -1) list.splice(index, 1);
}

function rowToMemoryOrder(row) {
  return {
    id: row.id,
    userId: row.user_id,
    side: row.side,
    type: row.type,
    price: row.price === null ? null : D.parse(row.price),
    quantity: D.parse(row.quantity),
    filled: D.parse(row.filled_quantity),
    lockedRemaining: D.parse(row.locked_remaining ?? "0"),
    createdAt: new Date(row.created_at).getTime(),
  };
}

export async function loadBook(pool) {
  book.buys = [];
  book.sells = [];
  const result = await pool.query(
    "SELECT * FROM orders WHERE market_id = $1 AND status IN ('OPEN','PARTIALLY_FILLED') ORDER BY created_at ASC",
    [MARKET_ID],
  );
  for (const row of result.rows) {
    const order = rowToMemoryOrder(row);
    (order.side === "BUY" ? book.buys : book.sells).push(order);
  }
  sortBook();

  const marketRow = await pool.query("SELECT status FROM markets WHERE id = $1", [MARKET_ID]);
  marketStatus = marketRow.rows[0]?.status ?? "ACTIVE";
}

/** Best bid/ask + shallow depth, read straight from the in-memory book (always in sync with committed DB state). */
export function getMarketSnapshot() {
  const levels = (list) => {
    const byPrice = new Map();
    for (const order of list) {
      const remaining = D.sub(order.quantity, order.filled);
      if (!D.isPositive(remaining)) continue;
      byPrice.set(order.price, D.add(byPrice.get(order.price) ?? 0n, remaining));
    }
    return [...byPrice.entries()].map(([price, quantity]) => ({ price: D.format(price), quantity: D.format(quantity) }));
  };
  const bids = levels(book.buys).slice(0, 20);
  const asks = levels(book.sells).slice(0, 20);
  return {
    marketId: MARKET_ID,
    status: marketStatus,
    bestBid: bids[0]?.price ?? null,
    bestAsk: asks[0]?.price ?? null,
    bids,
    asks,
  };
}

// --- Serialize all book-mutating operations through one mutex -------------
let chain = Promise.resolve();
function runExclusive(fn) {
  const result = chain.then(fn, fn);
  chain = result.then(
    () => {},
    () => {},
  );
  return result;
}

async function lockMarket(client) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [MARKET_ID]);
}

export function getMarketStatus() {
  return marketStatus;
}

/** Admin control: pause/resume the market. Cancels stay allowed either way — this only blocks new order placement. */
export async function setMarketStatus(pool, status) {
  if (!["ACTIVE", "PAUSED"].includes(status)) throw new OrderError("Market status must be ACTIVE or PAUSED.", 400);
  return runExclusive(async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await lockMarket(client);
      await client.query("UPDATE markets SET status = $1 WHERE id = $2", [status, MARKET_ID]);
      await client.query("COMMIT");
      marketStatus = status;
      return { marketId: MARKET_ID, status: marketStatus };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}

function statusFor(filled, quantity) {
  if (D.isZero(filled)) return "OPEN";
  return filled === quantity ? "FILLED" : "PARTIALLY_FILLED";
}

/** Settle one match: ledger postings for both users, both order rows, and the trade row — one atomic unit of work. */
async function settleTrade(client, { buy, buyNewFilled, buyNewStatus, sell, sellNewFilled, sellNewStatus, makerOrder, tradeQty, tradePrice }) {
  const tradeId = crypto.randomUUID();
  const entries = [];

  // BTC leg: seller -> buyer.
  let sellLockedConsumed = 0n;
  if (sell.type === "LIMIT") {
    const sellLockedId = await ensureAccount(client, { userId: sell.userId, asset: BASE_ASSET, accountType: "LOCKED" });
    sellLockedConsumed = sellNewStatus === "FILLED" ? sell.lockedRemaining : tradeQty;
    entries.push({ accountId: sellLockedId, asset: BASE_ASSET, direction: "DEBIT", amount: D.format(sellLockedConsumed), reason: "Trade executed", relatedType: "trade", relatedId: tradeId });
  } else {
    const sellAvailableId = await ensureAccount(client, { userId: sell.userId, asset: BASE_ASSET, accountType: "AVAILABLE" });
    entries.push({ accountId: sellAvailableId, asset: BASE_ASSET, direction: "DEBIT", amount: D.format(tradeQty), reason: "Trade executed (market order)", relatedType: "trade", relatedId: tradeId });
  }
  const buyerFee = D.mul(tradeQty, makerOrder.id === buy.id ? MAKER_FEE_RATE : TAKER_FEE_RATE);
  const buyerNet = D.sub(tradeQty, buyerFee);
  const buyAvailableBtcId = await ensureAccount(client, { userId: buy.userId, asset: BASE_ASSET, accountType: "AVAILABLE" });
  entries.push({ accountId: buyAvailableBtcId, asset: BASE_ASSET, direction: "CREDIT", amount: D.format(buyerNet), reason: "Trade executed", relatedType: "trade", relatedId: tradeId });
  if (D.isPositive(buyerFee)) {
    const feeBtcId = await ensureAccount(client, { asset: BASE_ASSET, accountType: "FEE" });
    entries.push({ accountId: feeBtcId, asset: BASE_ASSET, direction: "CREDIT", amount: D.format(buyerFee), reason: "Trade fee", relatedType: "trade", relatedId: tradeId });
  }

  // USDT leg: buyer -> seller (+ price-improvement refund to buyer, for LIMIT buyers only).
  const cost = D.mul(tradeQty, tradePrice);
  const sellerFee = D.mul(cost, makerOrder.id === sell.id ? MAKER_FEE_RATE : TAKER_FEE_RATE);
  const sellerNet = D.sub(cost, sellerFee);
  const sellAvailableUsdtId = await ensureAccount(client, { userId: sell.userId, asset: QUOTE_ASSET, accountType: "AVAILABLE" });
  entries.push({ accountId: sellAvailableUsdtId, asset: QUOTE_ASSET, direction: "CREDIT", amount: D.format(sellerNet), reason: "Trade executed", relatedType: "trade", relatedId: tradeId });
  if (D.isPositive(sellerFee)) {
    const feeUsdtId = await ensureAccount(client, { asset: QUOTE_ASSET, accountType: "FEE" });
    entries.push({ accountId: feeUsdtId, asset: QUOTE_ASSET, direction: "CREDIT", amount: D.format(sellerFee), reason: "Trade fee", relatedType: "trade", relatedId: tradeId });
  }

  if (buy.type === "LIMIT") {
    const buyLockedId = await ensureAccount(client, { userId: buy.userId, asset: QUOTE_ASSET, accountType: "LOCKED" });
    const lockedConsumed = buyNewStatus === "FILLED" ? buy.lockedRemaining : D.mul(tradeQty, buy.price);
    entries.push({ accountId: buyLockedId, asset: QUOTE_ASSET, direction: "DEBIT", amount: D.format(lockedConsumed), reason: "Trade executed", relatedType: "trade", relatedId: tradeId });
    const refund = D.sub(lockedConsumed, cost);
    if (D.isPositive(refund)) {
      const buyAvailableUsdtId = await ensureAccount(client, { userId: buy.userId, asset: QUOTE_ASSET, accountType: "AVAILABLE" });
      entries.push({ accountId: buyAvailableUsdtId, asset: QUOTE_ASSET, direction: "CREDIT", amount: D.format(refund), reason: "Price improvement refund", relatedType: "trade", relatedId: tradeId });
    }
  } else {
    const buyAvailableUsdtId = await ensureAccount(client, { userId: buy.userId, asset: QUOTE_ASSET, accountType: "AVAILABLE" });
    entries.push({ accountId: buyAvailableUsdtId, asset: QUOTE_ASSET, direction: "DEBIT", amount: D.format(cost), reason: "Trade executed (market order)", relatedType: "trade", relatedId: tradeId });
  }

  await postEntries(client, entries);

  if (buy.type === "LIMIT") buy.lockedRemaining = D.sub(buy.lockedRemaining, buyNewStatus === "FILLED" ? buy.lockedRemaining : D.mul(tradeQty, buy.price));
  if (sell.type === "LIMIT") sell.lockedRemaining = D.sub(sell.lockedRemaining, sellLockedConsumed);

  await client.query("UPDATE orders SET filled_quantity = $1, status = $2, locked_remaining = $3, updated_at = now() WHERE id = $4", [D.format(buyNewFilled), buyNewStatus, D.format(buy.lockedRemaining), buy.id]);
  await client.query("UPDATE orders SET filled_quantity = $1, status = $2, locked_remaining = $3, updated_at = now() WHERE id = $4", [D.format(sellNewFilled), sellNewStatus, D.format(sell.lockedRemaining), sell.id]);
  await client.query(
    "INSERT INTO trades (id, market_id, buy_order_id, sell_order_id, price, quantity, buyer_fee, seller_fee) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [tradeId, MARKET_ID, buy.id, sell.id, D.format(tradePrice), D.format(tradeQty), D.format(buyerFee), D.format(sellerFee)],
  );
  return { id: tradeId, price: D.format(tradePrice), quantity: D.format(tradeQty), buyerFee: D.format(buyerFee), sellerFee: D.format(sellerFee), buyerUserId: buy.userId, sellerUserId: sell.userId };
}

/**
 * Match a freshly-inserted taker order against the opposite side of the
 * book. Mutates `taker` and the resting maker orders in place, and writes
 * every fill through `settleTrade` inside the caller's transaction.
 */
async function matchTaker(client, taker) {
  const oppositeBook = taker.side === "BUY" ? book.sells : book.buys;
  const trades = [];
  // MARKET orders were never locked up front, so track spendable/sellable
  // balance locally as fills consume it (safe: the mutex guarantees nothing
  // else touches this user's balance mid-match).
  let marketBudget = null;
  if (taker.type === "MARKET") {
    const balances = await getBalances(client, taker.userId);
    const asset = taker.side === "BUY" ? QUOTE_ASSET : BASE_ASSET;
    const wallet = balances.find((b) => b.asset === asset);
    marketBudget = D.parse(wallet?.availableBalance ?? "0");
  }

  // Self-trade prevention: a user's incoming order skips their own resting
  // liquidity. This avoids creating artificial volume or wash trades.
  while (D.isPositive(D.sub(taker.quantity, taker.filled)) && oppositeBook.length > 0) {
    const makerIndex = oppositeBook.findIndex((candidate) => candidate.userId !== taker.userId);
    if (makerIndex < 0) break;
    const maker = oppositeBook[makerIndex];
    const takerRemaining = D.sub(taker.quantity, taker.filled);
    const makerRemaining = D.sub(maker.quantity, maker.filled);

    if (taker.type === "LIMIT") {
      const crosses = taker.side === "BUY" ? maker.price <= taker.price : maker.price >= taker.price;
      if (!crosses) break;
    }

    let matchQty = D.min(takerRemaining, makerRemaining);
    const tradePrice = maker.price;

    if (taker.type === "MARKET") {
      if (taker.side === "BUY") {
        const affordableQty = D.div(marketBudget, tradePrice);
        matchQty = D.min(matchQty, affordableQty);
      } else {
        matchQty = D.min(matchQty, marketBudget);
      }
      if (!D.isPositive(matchQty)) break; // out of funds — stop, don't reject what already filled.
    }

    const buy = taker.side === "BUY" ? taker : maker;
    const sell = taker.side === "SELL" ? taker : maker;

    taker.filled = D.add(taker.filled, matchQty);
    maker.filled = D.add(maker.filled, matchQty);
    const takerStatus = statusFor(taker.filled, taker.quantity);
    const makerStatus = statusFor(maker.filled, maker.quantity);
    const buyNewFilled = buy === taker ? taker.filled : maker.filled;
    const sellNewFilled = sell === taker ? taker.filled : maker.filled;
    const buyNewStatus = buy === taker ? takerStatus : makerStatus;
    const sellNewStatus = sell === taker ? takerStatus : makerStatus;

    const trade = await settleTrade(client, { buy, buyNewFilled, buyNewStatus, sell, sellNewFilled, sellNewStatus, makerOrder: maker, tradeQty: matchQty, tradePrice });
    trades.push(trade);

    if (taker.type === "MARKET") {
      marketBudget = taker.side === "BUY" ? D.sub(marketBudget, D.mul(matchQty, tradePrice)) : D.sub(marketBudget, matchQty);
    }
    if (!D.isPositive(D.sub(maker.quantity, maker.filled))) oppositeBook.splice(makerIndex, 1);
  }
  return trades;
}

const MIN_ORDER_QUANTITY = D.parse("0.00001");
const MAX_ORDER_QUANTITY = D.parse("100");
const MIN_LIMIT_NOTIONAL = D.parse("10");
const MAX_OPEN_ORDERS_PER_USER = 100;
const MAX_LIMIT_PRICE = D.parse("10000000");
const MAX_LIMIT_NOTIONAL = D.parse("100000000");

function validateOrderInput({ side, type, price, quantity }) {
  if (!["BUY", "SELL"].includes(side)) throw new OrderError("Side must be BUY or SELL.");
  if (!["LIMIT", "MARKET"].includes(type)) throw new OrderError("Type must be LIMIT or MARKET.");
  let quantityScaled;
  try {
    quantityScaled = D.parse(quantity);
  } catch {
    throw new OrderError("Quantity must be a decimal number.");
  }
  if (!D.isPositive(quantityScaled)) throw new OrderError("Quantity must be greater than zero.");
  if (quantityScaled < MIN_ORDER_QUANTITY) throw new OrderError("Quantity must be at least 0.00001 BTC.");
  if (quantityScaled > MAX_ORDER_QUANTITY) throw new OrderError("Quantity cannot exceed 100 BTC.");
  let priceScaled = null;
  if (type === "LIMIT") {
    try {
      priceScaled = D.parse(price);
    } catch {
      throw new OrderError("Limit orders require a decimal price.");
    }
    if (!D.isPositive(priceScaled)) throw new OrderError("Price must be greater than zero.");
    if (priceScaled > MAX_LIMIT_PRICE) throw new OrderError("Price cannot exceed 10,000,000 USDT.");
    const notional = D.mul(priceScaled, quantityScaled);
    if (notional < MIN_LIMIT_NOTIONAL) throw new OrderError("Order value must be at least 10 USDT.");
    if (notional > MAX_LIMIT_NOTIONAL) throw new OrderError("Order value cannot exceed 100,000,000 USDT.");
  }
  return { quantityScaled, priceScaled };
}

export async function placeOrder(pool, { userId, side, type, price, quantity, idempotencyKey = null }) {
  return runExclusive(async () => {
    const { quantityScaled, priceScaled } = validateOrderInput({ side, type, price, quantity });
    const requestHash = crypto
      .createHash("sha256")
      .update(JSON.stringify({
        side,
        type,
        price: priceScaled === null ? null : D.format(priceScaled),
        quantity: D.format(quantityScaled),
      }))
      .digest("hex");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await lockMarket(client);
      await loadBook(client);

      if (idempotencyKey) {
        const replay = await client.query("SELECT request_hash, response FROM order_requests WHERE user_id=$1 AND idempotency_key=$2", [userId, idempotencyKey]);
        if (replay.rows[0]) {
          if (replay.rows[0].request_hash && replay.rows[0].request_hash !== requestHash) {
            throw new OrderError("That idempotency key was already used for a different order.", 409);
          }
          await client.query("COMMIT");
          return replay.rows[0].response;
        }
      }

      if (marketStatus === "PAUSED") {
        throw new OrderError("The market is paused for maintenance — new orders are not being accepted right now.", 503);
      }

      const userRow = await client.query("SELECT trading_disabled AS \"tradingDisabled\" FROM users WHERE id = $1", [userId]);
      if (userRow.rows[0]?.tradingDisabled) {
        throw new OrderError("Trading has been disabled for this account.", 403);
      }

      if (type === "LIMIT") {
        const openCount = await client.query(
          "SELECT count(*)::int AS count FROM orders WHERE user_id=$1 AND market_id=$2 AND status IN ('OPEN','PARTIALLY_FILLED')",
          [userId, MARKET_ID],
        );
        if (openCount.rows[0].count >= MAX_OPEN_ORDERS_PER_USER) {
          throw new OrderError("You can have at most 100 open orders. Cancel an existing order and try again.", 429);
        }
      }

      const orderId = crypto.randomUUID();
      const createdAt = new Date();

      let lockAmount = 0n;
      if (type === "LIMIT") {
        const lockAsset = side === "BUY" ? QUOTE_ASSET : BASE_ASSET;
        lockAmount = side === "BUY" ? D.mul(quantityScaled, priceScaled) : quantityScaled;
        const balances = await getBalances(client, userId);
        const wallet = balances.find((b) => b.asset === lockAsset);
        const available = D.parse(wallet?.availableBalance ?? "0");
        if (available < lockAmount) {
          throw new OrderError(`Insufficient ${lockAsset} available balance to place this order.`, 402);
        }
        await transferWithinUser(client, { userId, asset: lockAsset, amount: D.format(lockAmount), fromType: "AVAILABLE", toType: "LOCKED", reason: "Order placed", relatedType: "order", relatedId: orderId });
      }

      await client.query(
        `INSERT INTO orders (id, user_id, market_id, side, type, price, quantity, filled_quantity, locked_remaining, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,'OPEN',$9,$9)`,
        [orderId, userId, MARKET_ID, side, type, priceScaled === null ? null : D.format(priceScaled), D.format(quantityScaled), D.format(lockAmount), createdAt],
      );

      const taker = { id: orderId, userId, side, type, price: priceScaled, quantity: quantityScaled, filled: 0n, lockedRemaining: lockAmount, createdAt: createdAt.getTime() };
      const trades = await matchTaker(client, taker);

      const remaining = D.sub(taker.quantity, taker.filled);
      let finalStatus = statusFor(taker.filled, taker.quantity);
      if (type === "MARKET" && D.isPositive(remaining)) {
        // No resting market orders: whatever didn't fill right now (out of book
        // depth or out of funds) is done, not queued. CANCELLED is the closing
        // status either way — filled_quantity is what actually shows how much
        // executed, so a 0.3-of-1 fill isn't mislabeled as "FILLED".
        finalStatus = "CANCELLED";
      }
      await client.query("UPDATE orders SET status = $1, updated_at = now() WHERE id = $2", [finalStatus, orderId]);

      const affectedUserIds = [...new Set([userId, ...trades.flatMap((trade) => [trade.buyerUserId, trade.sellerUserId])])];
      const publicTrades = trades.map(({ buyerUserId: _buyerUserId, sellerUserId: _sellerUserId, ...trade }) => trade);
      const result = { orderId, status: finalStatus, filledQuantity: D.format(taker.filled), trades: publicTrades, affectedUserIds };
      if (idempotencyKey) {
        await client.query(
          "INSERT INTO order_requests (user_id,idempotency_key,request_hash,response) VALUES ($1,$2,$3,$4::jsonb)",
          [userId, idempotencyKey, requestHash, JSON.stringify(result)],
        );
      }
      await client.query("COMMIT");

      if (type === "LIMIT" && D.isPositive(remaining)) {
        insertSorted(side, { ...taker, filled: taker.filled });
      }

      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      await loadBook(client);
      throw error;
    } finally {
      client.release();
    }
  });
}

export async function cancelOrder(pool, { userId, orderId }) {
  return runExclusive(async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await lockMarket(client);
      await loadBook(client);
      const result = await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
      const order = result.rows[0];
      if (!order) throw new OrderError("Order not found.", 404);
      if (order.user_id !== userId) throw new OrderError("That order does not belong to you.", 403);
      if (!["OPEN", "PARTIALLY_FILLED"].includes(order.status)) throw new OrderError("Order is no longer open.", 409);

      const remaining = D.sub(D.parse(order.quantity), D.parse(order.filled_quantity));
      if (D.isPositive(remaining) && order.type === "LIMIT") {
        const unlockAsset = order.side === "BUY" ? QUOTE_ASSET : BASE_ASSET;
        const unlockAmount = D.parse(order.locked_remaining);
        await transferWithinUser(client, { userId, asset: unlockAsset, amount: D.format(unlockAmount), fromType: "LOCKED", toType: "AVAILABLE", reason: "Order cancelled", relatedType: "order", relatedId: orderId });
      }
      await client.query("UPDATE orders SET status = 'CANCELLED', locked_remaining = 0, updated_at = now() WHERE id = $1", [orderId]);
      await client.query("COMMIT");
      removeFromBook(order.side, orderId);
      return { orderId, status: "CANCELLED" };
    } catch (error) {
      await client.query("ROLLBACK");
      await loadBook(client);
      throw error;
    } finally {
      client.release();
    }
  });
}

export async function getOpenOrders(pool, userId) {
  const result = await pool.query(
    "SELECT id, side, type, price, quantity, filled_quantity AS \"filledQuantity\", status, created_at AS \"createdAt\" FROM orders WHERE user_id = $1 AND market_id = $2 AND status IN ('OPEN','PARTIALLY_FILLED') ORDER BY created_at DESC",
    [userId, MARKET_ID],
  );
  return result.rows;
}

export async function getOrderHistory(pool, userId) {
  const result = await pool.query(
    "SELECT id, side, type, price, quantity, filled_quantity AS \"filledQuantity\", status, created_at AS \"createdAt\", updated_at AS \"updatedAt\" FROM orders WHERE user_id = $1 AND market_id = $2 ORDER BY created_at DESC LIMIT 100",
    [userId, MARKET_ID],
  );
  return result.rows;
}

export async function getTradeHistory(pool, userId) {
  const result = await pool.query(
    `SELECT t.id, t.price, t.quantity, t.created_at AS "createdAt", CASE WHEN buyer.user_id = $1 THEN 'BUY' ELSE 'SELL' END AS side,
            CASE WHEN buyer.user_id = $1 THEN t.buyer_fee ELSE t.seller_fee END AS fee,
            CASE WHEN buyer.user_id = $1 THEN '${BASE_ASSET}' ELSE '${QUOTE_ASSET}' END AS "feeAsset"
     FROM trades t
     JOIN orders buyer ON buyer.id = t.buy_order_id
     JOIN orders seller ON seller.id = t.sell_order_id
     WHERE t.market_id = $2 AND (buyer.user_id = $1 OR seller.user_id = $1)
     ORDER BY t.created_at DESC LIMIT 100`,
    [userId, MARKET_ID],
  );
  return result.rows;
}

/** Recent public executions for the market chart and live tape. */
export async function getRecentMarketTrades(pool, limit = 60) {
  const result = await pool.query(
    'SELECT id, price, quantity, created_at AS "createdAt" FROM trades WHERE market_id = $1 ORDER BY created_at DESC LIMIT $2',
    [MARKET_ID, limit],
  );
  return result.rows.reverse();
}

// --- Admin-scoped queries --------------------------------------------------
// Unlike the functions above, these are not filtered to one user — they're
// for the admin dashboard, which needs to see every order/trade on the
// market. Kept in this module rather than admin.mjs because they need the
// same market_id constant and row-shaping conventions as the rest of the
// order/trade queries above.

/** All orders on the market, optionally filtered by status, newest first. Includes the owner's email for display. */
export async function getAllOrders(pool, { status = null, limit = 20, cursor = null } = {}) {
  const params = [MARKET_ID];
  let where = "o.market_id = $1";
  if (status) {
    params.push(status);
    where += ` AND o.status = $${params.length}`;
  }
  const countParams = [...params];
  const countWhere = where;
  const decoded = decodeCursor(cursor);
  if (decoded) {
    params.push(decoded.createdAt, decoded.id);
    where += ` AND (o.created_at, o.id) < ($${params.length - 1}, $${params.length})`;
  }
  const count = await pool.query(`SELECT count(*)::int AS total FROM orders o WHERE ${countWhere}`, countParams);
  params.push(limit + 1);
  const result = await pool.query(
    `SELECT o.id, o.side, o.type, o.price, o.quantity, o.filled_quantity AS "filledQuantity", o.status,
            o.created_at AS "createdAt", o.updated_at AS "updatedAt", o.user_id AS "userId", u.email AS "userEmail"
     FROM orders o
     JOIN users u ON u.id = o.user_id
     WHERE ${where}
     ORDER BY o.created_at DESC, o.id DESC
     LIMIT $${params.length}`,
    params,
  );
  return { ...cursorPage(result.rows, limit), total: count.rows[0].total };
}

/** All trades on the market, newest first. Includes both parties' emails for display. */
export async function getAllTrades(pool, { limit = 20, cursor = null } = {}) {
  const count = await pool.query("SELECT count(*)::int AS total FROM trades WHERE market_id = $1", [MARKET_ID]);
  const decoded = decodeCursor(cursor);
  const cursorWhere = decoded ? " AND (t.created_at, t.id) < ($2, $3)" : "";
  const params = decoded ? [MARKET_ID, decoded.createdAt, decoded.id, limit + 1] : [MARKET_ID, limit + 1];
  const result = await pool.query(
    `SELECT t.id, t.price, t.quantity, t.buyer_fee AS "buyerFee", t.seller_fee AS "sellerFee", t.created_at AS "createdAt",
            buyer.user_id AS "buyerId", buyerUser.email AS "buyerEmail",
            seller.user_id AS "sellerId", sellerUser.email AS "sellerEmail"
     FROM trades t
     JOIN orders buyer ON buyer.id = t.buy_order_id
     JOIN orders seller ON seller.id = t.sell_order_id
     JOIN users buyerUser ON buyerUser.id = buyer.user_id
     JOIN users sellerUser ON sellerUser.id = seller.user_id
     WHERE t.market_id = $1${cursorWhere}
     ORDER BY t.created_at DESC, t.id DESC
     LIMIT $${params.length}`,
    params,
  );
  return { ...cursorPage(result.rows, limit), total: count.rows[0].total };
}
