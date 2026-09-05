// Phase 5: Stop-Loss, Take-Profit orders, and order chains (OCO).
//
// These are "conditional" orders: they don't touch the order book or lock
// funds themselves. They sit in `advanced_orders` until the monitor service
// (see monitor-service.mjs) observes a matching market price, at which point
// they're executed as an ordinary MARKET order through matching.mjs's
// `placeOrder` — the same locking, settlement, and ledger guarantees as any
// other order apply, so this module never touches the ledger directly.
//
// This app is a single-market demo (matching.MARKET_ID, "BTC-USDT"), so
// advanced orders don't reference a `markets` table the way a multi-market
// exchange would; they're always against that one market.

import crypto from "node:crypto";
import * as D from "./decimal.mjs";
import { MARKET_ID, OrderError, placeOrder } from "./matching.mjs";

export async function ensureAdvancedOrdersSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS advanced_orders (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      market_id TEXT NOT NULL DEFAULT '${MARKET_ID}',
      order_type TEXT NOT NULL CHECK (order_type IN ('STOP_LOSS','TAKE_PROFIT','TRAILING_STOP')),
      side TEXT NOT NULL DEFAULT 'SELL' CHECK (side IN ('BUY','SELL')),
      trigger_price NUMERIC(28,8),
      trail_percent NUMERIC(28,8) CHECK (trail_percent IS NULL OR trail_percent > 0),
      high_water_mark NUMERIC(28,8),
      current_trigger_price NUMERIC(28,8),
      quantity NUMERIC(28,8) NOT NULL CHECK (quantity > 0),
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','FILLED','CANCELED','FAILED')),
      triggered_at TIMESTAMPTZ,
      fill_price NUMERIC(28,8),
      filled_order_id UUID,
      chain_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT advanced_orders_trigger_fields CHECK (
        (order_type IN ('STOP_LOSS','TAKE_PROFIT') AND trigger_price IS NOT NULL AND trail_percent IS NULL)
        OR (order_type = 'TRAILING_STOP' AND trail_percent IS NOT NULL AND trigger_price IS NULL)
      )
    );
    CREATE INDEX IF NOT EXISTS advanced_orders_user_idx ON advanced_orders (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS advanced_orders_active_idx ON advanced_orders (market_id) WHERE status = 'ACTIVE';
    CREATE INDEX IF NOT EXISTS advanced_orders_chain_idx ON advanced_orders (chain_id) WHERE chain_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS trailing_stop_history (
      id UUID PRIMARY KEY,
      advanced_order_id UUID NOT NULL REFERENCES advanced_orders(id) ON DELETE CASCADE,
      price NUMERIC(28,8) NOT NULL,
      trigger_price NUMERIC(28,8) NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS trailing_stop_history_order_idx ON trailing_stop_history (advanced_order_id, recorded_at DESC);

    CREATE TABLE IF NOT EXISTS order_chains (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_trade_id UUID,
      stop_loss_order_id UUID REFERENCES advanced_orders(id),
      take_profit_order_id UUID REFERENCES advanced_orders(id),
      trailing_stop_order_id UUID REFERENCES advanced_orders(id),
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPLETED','CANCELED')),
      triggered_by_order_id UUID,
      triggered_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS order_chains_user_idx ON order_chains (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS order_chains_parent_trade_idx ON order_chains (parent_trade_id);
  `);
}

function parsePositiveDecimal(value, label) {
  let scaled;
  try {
    scaled = D.parse(value);
  } catch {
    throw new OrderError(`${label} must be a decimal number.`, 400);
  }
  if (!D.isPositive(scaled)) throw new OrderError(`${label} must be greater than zero.`, 400);
  return scaled;
}

/** Create a stop-loss order: triggers a MARKET sell once price falls to/below triggerPrice. */
export async function createStopLossOrder(pool, userId, { triggerPrice, quantity, notes = null }) {
  const triggerScaled = parsePositiveDecimal(triggerPrice, "Trigger price");
  const quantityScaled = parsePositiveDecimal(quantity, "Quantity");
  const id = crypto.randomUUID();
  const result = await pool.query(
    `INSERT INTO advanced_orders (id, user_id, market_id, order_type, side, trigger_price, quantity, notes, status)
     VALUES ($1,$2,$3,'STOP_LOSS','SELL',$4,$5,$6,'ACTIVE')
     RETURNING *`,
    [id, userId, MARKET_ID, D.format(triggerScaled), D.format(quantityScaled), notes],
  );
  return result.rows[0];
}

/** Create a take-profit order: triggers a MARKET sell once price rises to/above triggerPrice. */
export async function createTakeProfitOrder(pool, userId, { triggerPrice, quantity, notes = null }) {
  const triggerScaled = parsePositiveDecimal(triggerPrice, "Trigger price");
  const quantityScaled = parsePositiveDecimal(quantity, "Quantity");
  const id = crypto.randomUUID();
  const result = await pool.query(
    `INSERT INTO advanced_orders (id, user_id, market_id, order_type, side, trigger_price, quantity, notes, status)
     VALUES ($1,$2,$3,'TAKE_PROFIT','SELL',$4,$5,$6,'ACTIVE')
     RETURNING *`,
    [id, userId, MARKET_ID, D.format(triggerScaled), D.format(quantityScaled), notes],
  );
  return result.rows[0];
}

export function shouldTriggerStopLoss(order, currentPrice) {
  return D.parse(currentPrice) <= D.parse(order.trigger_price);
}

export function shouldTriggerTakeProfit(order, currentPrice) {
  return D.parse(currentPrice) >= D.parse(order.trigger_price);
}

/** Execute a triggered advanced order as a MARKET order through the real matching engine. */
export async function executeAdvancedOrder(pool, order) {
  const placed = await placeOrder(pool, {
    userId: order.user_id,
    side: order.side,
    type: "MARKET",
    quantity: order.quantity,
  });
  const fillPrice = placed.trades.length ? placed.trades[placed.trades.length - 1].price : null;
  const updated = await pool.query(
    `UPDATE advanced_orders
     SET status = 'FILLED', triggered_at = now(), fill_price = $1, filled_order_id = $2, updated_at = now()
     WHERE id = $3
     RETURNING *`,
    [fillPrice, placed.orderId, order.id],
  );
  if (order.chain_id) await completeChainSibling(pool, order.chain_id, order.id);
  return { advancedOrder: updated.rows[0], placedOrder: placed };
}

async function completeChainSibling(pool, chainId, triggeredOrderId) {
  const canceled = await pool.query(
    `UPDATE advanced_orders SET status = 'CANCELED', updated_at = now()
     WHERE chain_id = $1 AND id <> $2 AND status = 'ACTIVE'
     RETURNING id`,
    [chainId, triggeredOrderId],
  );
  await pool.query(
    `UPDATE order_chains SET status = 'COMPLETED', triggered_by_order_id = $1, triggered_at = now(), updated_at = now()
     WHERE id = $2`,
    [triggeredOrderId, chainId],
  );
  return canceled.rows.map((row) => row.id);
}

/** Cancel any active advanced order (stop-loss, take-profit, or trailing stop) owned by userId. */
export async function cancelAdvancedOrder(pool, userId, orderId) {
  const result = await pool.query(
    `UPDATE advanced_orders SET status = 'CANCELED', updated_at = now()
     WHERE id = $1 AND user_id = $2 AND status = 'ACTIVE'
     RETURNING *`,
    [orderId, userId],
  );
  if (!result.rows.length) throw new OrderError("Advanced order not found or not active.", 404);
  return result.rows[0];
}

export async function getUserAdvancedOrders(pool, userId) {
  const result = await pool.query(
    `SELECT * FROM advanced_orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [userId],
  );
  return result.rows;
}

export async function getAdvancedOrderById(pool, userId, orderId) {
  const result = await pool.query(`SELECT * FROM advanced_orders WHERE id = $1 AND user_id = $2`, [orderId, userId]);
  if (!result.rows.length) throw new OrderError("Advanced order not found.", 404);
  return result.rows[0];
}

/** All ACTIVE advanced orders across all users — used by the monitor service. */
export async function getActiveAdvancedOrders(pool) {
  const result = await pool.query(`SELECT * FROM advanced_orders WHERE status = 'ACTIVE' ORDER BY created_at ASC`);
  return result.rows;
}

/**
 * Create an order chain — an OCO (one-cancels-other) group. Provide at
 * least one of stopLoss / takeProfit / trailingStop as `{ triggerPrice,
 * quantity, notes }` (or `{ trailPercent, quantity, notes }` for
 * trailingStop). When any one order in the chain fills, its siblings are
 * automatically canceled (see completeChainSibling above).
 */
export async function createOrderChain(pool, userId, { parentTradeId = null, stopLoss = null, takeProfit = null, trailingStop = null }) {
  if (!stopLoss && !takeProfit && !trailingStop) {
    throw new OrderError("An order chain needs at least one of stopLoss, takeProfit, or trailingStop.", 400);
  }
  const chainId = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let stopLossOrder = null;
    let takeProfitOrder = null;
    let trailingStopOrder = null;
    if (stopLoss) stopLossOrder = await createStopLossOrder(client, userId, stopLoss);
    if (takeProfit) takeProfitOrder = await createTakeProfitOrder(client, userId, takeProfit);
    if (trailingStop) {
      const { createTrailingStopOrder } = await import("./trailing-stops.mjs");
      trailingStopOrder = await createTrailingStopOrder(client, userId, trailingStop);
    }
    for (const order of [stopLossOrder, takeProfitOrder, trailingStopOrder]) {
      if (!order) continue;
      await client.query("UPDATE advanced_orders SET chain_id = $1 WHERE id = $2", [chainId, order.id]);
    }
    const chain = await client.query(
      `INSERT INTO order_chains (id, user_id, parent_trade_id, stop_loss_order_id, take_profit_order_id, trailing_stop_order_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE')
       RETURNING *`,
      [chainId, userId, parentTradeId, stopLossOrder?.id ?? null, takeProfitOrder?.id ?? null, trailingStopOrder?.id ?? null],
    );
    await client.query("COMMIT");
    return chain.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getOrderChain(pool, userId, chainId) {
  const result = await pool.query(`SELECT * FROM order_chains WHERE id = $1 AND user_id = $2`, [chainId, userId]);
  if (!result.rows.length) throw new OrderError("Order chain not found.", 404);
  return result.rows[0];
}

export async function getOrderChainsForTrade(pool, userId, parentTradeId) {
  const result = await pool.query(
    `SELECT * FROM order_chains WHERE user_id = $1 AND parent_trade_id = $2 ORDER BY created_at DESC`,
    [userId, parentTradeId],
  );
  return result.rows;
}
