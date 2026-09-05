// Phase 5: Trailing stop orders.
//
// A trailing stop tracks the best (highest) price seen since it was placed
// and re-computes its trigger price as a percentage below that high-water
// mark. It only ever ratchets up (never down), so it locks in gains as the
// price rises while still giving room for normal price movement. Shares the
// `advanced_orders` table and execution path with stop-loss/take-profit
// (see advanced-orders.mjs) — a trailing stop is really a stop-loss whose
// trigger price is recalculated on every tick instead of fixed.

import crypto from "node:crypto";
import * as D from "./decimal.mjs";
import { OrderError } from "./matching.mjs";

function computeTriggerFromHighWaterMark(highWaterMarkScaled, trailPercentScaled) {
  // trigger = highWaterMark * (1 - trailPercent / 100)
  const hundred = D.parse("100");
  const factor = D.sub(hundred, trailPercentScaled); // e.g. 100 - 5 = 95
  return D.div(D.mul(highWaterMarkScaled, factor), hundred);
}

/**
 * Create a trailing stop order. `referencePrice` is the current market
 * price to seed the initial high-water mark from (the caller — the API
 * route or order-chain creator — is responsible for supplying a real price,
 * typically the best bid or last trade price).
 */
export async function createTrailingStopOrder(pool, userId, { trailPercent, quantity, notes = null, referencePrice }) {
  let trailScaled;
  try {
    trailScaled = D.parse(trailPercent);
  } catch {
    throw new OrderError("Trail percent must be a decimal number.", 400);
  }
  if (!D.isPositive(trailScaled)) throw new OrderError("Trail percent must be greater than zero.", 400);
  if (trailScaled >= D.parse("100")) throw new OrderError("Trail percent must be less than 100.", 400);

  let quantityScaled;
  try {
    quantityScaled = D.parse(quantity);
  } catch {
    throw new OrderError("Quantity must be a decimal number.", 400);
  }
  if (!D.isPositive(quantityScaled)) throw new OrderError("Quantity must be greater than zero.", 400);

  if (referencePrice === undefined || referencePrice === null) {
    throw new OrderError("Cannot create a trailing stop: no market price is available yet.", 409);
  }
  const priceScaled = D.parse(referencePrice);
  const triggerScaled = computeTriggerFromHighWaterMark(priceScaled, trailScaled);

  const id = crypto.randomUUID();
  const result = await pool.query(
    `INSERT INTO advanced_orders
       (id, user_id, order_type, side, trail_percent, high_water_mark, current_trigger_price, quantity, notes, status)
     VALUES ($1,$2,'TRAILING_STOP','SELL',$3,$4,$5,$6,$7,'ACTIVE')
     RETURNING *`,
    [id, userId, D.format(trailScaled), D.format(priceScaled), D.format(triggerScaled), D.format(quantityScaled), notes],
  );
  const order = result.rows[0];
  await pool.query(
    `INSERT INTO trailing_stop_history (id, advanced_order_id, price, trigger_price) VALUES ($1,$2,$3,$4)`,
    [crypto.randomUUID(), order.id, D.format(priceScaled), D.format(triggerScaled)],
  );
  return order;
}

/**
 * Ratchet a trailing stop's high-water mark and trigger price up if
 * `currentPrice` is a new high. No-op (returns the unchanged order) if the
 * price hasn't made a new high. Call this before checking
 * shouldTriggerTrailingStop on every monitor tick.
 */
export async function updateTrailingStop(pool, order, currentPrice) {
  const current = D.parse(currentPrice);
  const highWaterMark = D.parse(order.high_water_mark);
  if (current <= highWaterMark) return order;

  const trailPercent = D.parse(order.trail_percent);
  const newTrigger = computeTriggerFromHighWaterMark(current, trailPercent);
  const result = await pool.query(
    `UPDATE advanced_orders SET high_water_mark = $1, current_trigger_price = $2, updated_at = now()
     WHERE id = $3
     RETURNING *`,
    [D.format(current), D.format(newTrigger), order.id],
  );
  await pool.query(
    `INSERT INTO trailing_stop_history (id, advanced_order_id, price, trigger_price) VALUES ($1,$2,$3,$4)`,
    [crypto.randomUUID(), order.id, D.format(current), D.format(newTrigger)],
  );
  return result.rows[0];
}

export function shouldTriggerTrailingStop(order, currentPrice) {
  return D.parse(currentPrice) <= D.parse(order.current_trigger_price);
}

export async function getTrailingStopHistory(pool, userId, orderId) {
  const owner = await pool.query(`SELECT id FROM advanced_orders WHERE id = $1 AND user_id = $2`, [orderId, userId]);
  if (!owner.rows.length) throw new OrderError("Trailing stop order not found.", 404);
  const result = await pool.query(
    `SELECT price, trigger_price AS "triggerPrice", recorded_at AS "recordedAt"
     FROM trailing_stop_history WHERE advanced_order_id = $1 ORDER BY recorded_at ASC`,
    [orderId],
  );
  return result.rows;
}

export async function getTrailingStopStats(pool, userId, orderId) {
  const order = await pool.query(`SELECT * FROM advanced_orders WHERE id = $1 AND user_id = $2`, [orderId, userId]);
  if (!order.rows.length) throw new OrderError("Trailing stop order not found.", 404);
  const row = order.rows[0];
  const history = await pool.query(
    `SELECT MIN(price) AS "lowestPrice", MAX(price) AS "highestPrice", COUNT(*)::int AS "updateCount"
     FROM trailing_stop_history WHERE advanced_order_id = $1`,
    [orderId],
  );
  return {
    orderId: row.id,
    status: row.status,
    trailPercent: row.trail_percent,
    highWaterMark: row.high_water_mark,
    currentTriggerPrice: row.current_trigger_price,
    ...history.rows[0],
  };
}
