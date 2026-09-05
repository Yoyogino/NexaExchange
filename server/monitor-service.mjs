// Phase 5: background monitor that polls the market price and triggers
// stop-loss / take-profit / trailing-stop orders.
//
// Runs on a simple setInterval, serialized so a slow tick can never overlap
// the next one. Every trigger is executed through matching.mjs's
// `placeOrder` (see advanced-orders.mjs), so it gets the exact same
// locking/settlement/ledger guarantees as a user-submitted order — this
// service never writes to the ledger or order book directly.

import { getMarketSnapshot, getRecentMarketTrades } from "./matching.mjs";
import { executeAdvancedOrder, getActiveAdvancedOrders, shouldTriggerStopLoss, shouldTriggerTakeProfit } from "./advanced-orders.mjs";
import { shouldTriggerTrailingStop, updateTrailingStop } from "./trailing-stops.mjs";

const DEFAULT_INTERVAL_MS = 1000;

let timer = null;
let running = false;
let lastTickAt = null;
let lastError = null;
let totalTicks = 0;
let totalTriggered = 0;

function log(event, fields = {}) {
  console.log(JSON.stringify({ event, ...fields }));
}

/** Best current reference price for evaluating triggers: best bid (what a SELL would fill against), falling back to the last traded price. */
async function currentReferencePrice(pool) {
  const snapshot = getMarketSnapshot();
  if (snapshot.bestBid) return snapshot.bestBid;
  const recent = await getRecentMarketTrades(pool, 1);
  return recent[0]?.price ?? null;
}

async function tick(pool, events) {
  if (running) return; // never overlap ticks
  running = true;
  try {
    const price = await currentReferencePrice(pool);
    totalTicks += 1;
    lastTickAt = new Date();
    if (price === null) return; // no price yet (empty book, no trades) — nothing to check

    const orders = await getActiveAdvancedOrders(pool);
    const affectedUserIds = new Set();
    for (const order of orders) {
      try {
        let current = order;
        let triggered = false;
        if (order.order_type === "TRAILING_STOP") {
          current = await updateTrailingStop(pool, order, price);
          triggered = shouldTriggerTrailingStop(current, price);
        } else if (order.order_type === "STOP_LOSS") {
          triggered = shouldTriggerStopLoss(current, price);
        } else if (order.order_type === "TAKE_PROFIT") {
          triggered = shouldTriggerTakeProfit(current, price);
        }
        if (!triggered) continue;
        const { advancedOrder, placedOrder } = await executeAdvancedOrder(pool, current);
        totalTriggered += 1;
        affectedUserIds.add(order.user_id);
        for (const uid of placedOrder.affectedUserIds ?? []) affectedUserIds.add(uid);
        log("advanced_order_triggered", { orderId: advancedOrder.id, orderType: advancedOrder.order_type, userId: order.user_id, fillPrice: advancedOrder.fill_price });
      } catch (error) {
        log("advanced_order_execution_failed", { orderId: order.id, message: error.message });
      }
    }
    if (events && affectedUserIds.size) {
      events.publish("market");
      events.publish("account", [...affectedUserIds]);
    }
    lastError = null;
  } catch (error) {
    lastError = error.message;
    log("monitor_tick_failed", { message: error.message });
  } finally {
    running = false;
  }
}

export function startMonitoring(pool, { events = null, intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  if (timer) return;
  timer = setInterval(() => {
    tick(pool, events);
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  log("monitor_started", { intervalMs });
}

export function stopMonitoring() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  log("monitor_stopped", {});
}

export function getMonitorStatus() {
  return { running: timer !== null, lastTickAt, lastError, totalTicks, totalTriggered };
}
