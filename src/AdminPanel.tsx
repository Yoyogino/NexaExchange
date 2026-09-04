import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Account,
  AdminOrder,
  AdminTrade,
  AdminUser,
  Asset,
  AuditEvent,
  MarketSnapshot,
  SystemHealth,
  OrderStatus,
  adjustUserBalance,
  getAdminAudit,
  getAdminMarket,
  getAdminOrders,
  getAdminTrades,
  getAdminUsers,
  getAdminSystemHealth,
  pauseMarket,
  resumeMarket,
  setUserTrading,
} from "./api";

// Same "poll while mounted" simplification as Dashboard.tsx — see the note
// there. The admin panel is a lower-traffic view, so a slightly slower
// cadence is fine.
const POLL_INTERVAL_MS = 3000;
const USERS_PER_PAGE = 10;
const ROWS_PER_PAGE = 12;
const ORDER_STATUSES: OrderStatus[] = ["OPEN", "PARTIALLY_FILLED", "FILLED", "CANCELLED"];

const formatAmount = (value: string) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 8 });
const formatDateTime = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function Pagination({ page, hasMore, onPrevious, onNext, label }: { page: number; hasMore: boolean; onPrevious: () => void; onNext: () => void; label: string }) {
  if (page === 1 && !hasMore) return null;
  return <nav className="pagination" aria-label={`${label} pages`}><button type="button" className="link" onClick={onPrevious} disabled={page === 1}>Previous</button><span>Page {page}</span><button type="button" className="link" onClick={onNext} disabled={!hasMore}>Next</button></nav>;
}

export function AdminPanel({ token, account, onBack, onSignOut }: { token: string; account: Account; onBack: () => void; onSignOut: () => void }) {
  const [market, setMarket] = useState<MarketSnapshot | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [trades, setTrades] = useState<AdminTrade[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [orderStatusFilter, setOrderStatusFilter] = useState<OrderStatus | "">("");
  const [refreshError, setRefreshError] = useState("");
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [userCursors, setUserCursors] = useState<(string | null)[]>([null]);
  const [userTotal, setUserTotal] = useState(0);
  const [userNextCursor, setUserNextCursor] = useState<string | null>(null);
  const [userHasMore, setUserHasMore] = useState(false);
  const [orderCursors, setOrderCursors] = useState<(string | null)[]>([null]);
  const [orderNextCursor, setOrderNextCursor] = useState<string | null>(null);
  const [orderHasMore, setOrderHasMore] = useState(false);
  const [tradeCursors, setTradeCursors] = useState<(string | null)[]>([null]);
  const [tradeNextCursor, setTradeNextCursor] = useState<string | null>(null);
  const [tradeHasMore, setTradeHasMore] = useState(false);
  const [auditCursors, setAuditCursors] = useState<(string | null)[]>([null]);
  const [auditNextCursor, setAuditNextCursor] = useState<string | null>(null);
  const [auditHasMore, setAuditHasMore] = useState(false);

  const [marketBusy, setMarketBusy] = useState(false);
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null);

  const [adjustUserId, setAdjustUserId] = useState<string | null>(null);
  const [adjustAsset, setAdjustAsset] = useState<Asset>("USDT");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustError, setAdjustError] = useState("");
  const [adjustBusy, setAdjustBusy] = useState(false);

  const refreshAll = useCallback(async () => {
    try {
      const [nextMarket, nextUsers, nextOrders, nextTrades, nextAudit, nextHealth] = await Promise.all([
        getAdminMarket(token),
        getAdminUsers(token, { search: userSearch, cursor: userCursors.at(-1), limit: USERS_PER_PAGE }),
        getAdminOrders(token, orderStatusFilter || undefined, orderCursors.at(-1), ROWS_PER_PAGE),
        getAdminTrades(token, tradeCursors.at(-1), ROWS_PER_PAGE),
        getAdminAudit(token, auditCursors.at(-1), ROWS_PER_PAGE),
        getAdminSystemHealth(token),
      ]);
      setMarket(nextMarket);
      setUsers(nextUsers.items);
      setUserTotal(nextUsers.total);
      setUserNextCursor(nextUsers.nextCursor); setUserHasMore(nextUsers.hasMore);
      setOrders(nextOrders.items); setOrderNextCursor(nextOrders.nextCursor); setOrderHasMore(nextOrders.hasMore);
      setTrades(nextTrades.items); setTradeNextCursor(nextTrades.nextCursor); setTradeHasMore(nextTrades.hasMore);
      setAudit(nextAudit.items); setAuditNextCursor(nextAudit.nextCursor); setAuditHasMore(nextAudit.hasMore);
      setSystemHealth(nextHealth);
      setRefreshError("");
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "Could not refresh admin data.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, orderStatusFilter, userSearch, userCursors, orderCursors, tradeCursors, auditCursors]);

  useEffect(() => {
    refreshAll();
    const timer = setInterval(refreshAll, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refreshAll]);

  async function toggleMarket() {
    if (!market) return;
    setMarketBusy(true);
    try {
      if (market.status === "ACTIVE") await pauseMarket(token);
      else await resumeMarket(token);
      await refreshAll();
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "Could not change market status.");
    } finally {
      setMarketBusy(false);
    }
  }

  async function toggleTrading(user: AdminUser) {
    setTogglingUserId(user.id);
    try {
      await setUserTrading(token, user.id, !user.tradingDisabled);
      await refreshAll();
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "Could not change trading access.");
    } finally {
      setTogglingUserId(null);
    }
  }

  function openAdjustForm(user: AdminUser) {
    setAdjustUserId(user.id);
    setAdjustAsset("USDT");
    setAdjustAmount("");
    setAdjustReason("");
    setAdjustError("");
  }

  async function submitAdjustment(event: FormEvent) {
    event.preventDefault();
    if (!adjustUserId) return;
    setAdjustError("");
    setAdjustBusy(true);
    try {
      await adjustUserBalance(token, adjustUserId, { asset: adjustAsset, amount: adjustAmount, reason: adjustReason });
      setAdjustUserId(null);
      await refreshAll();
    } catch (error) {
      setAdjustError(error instanceof Error ? error.message : "Could not adjust balance.");
    } finally {
      setAdjustBusy(false);
    }
  }

  const adjustTarget = users.find((u) => u.id === adjustUserId) ?? null;
  const currentUserPage = userCursors.length;
  const currentOrderPage = orderCursors.length;
  const currentTradePage = tradeCursors.length;
  const currentAuditPage = auditCursors.length;

  return (
    <main id="main-content" className="dashboard">
      <a className="skip-link" href="#admin-users">Skip to user controls</a>
      <header className="dash-header">
        <div>
          <p className="eyebrow">ADMIN</p>
          <h1 className="dash-title">Exchange operations</h1>
          <p className="lead">{account.user.email} · admin access</p>
        </div>
        <div>
          <button className="link" type="button" onClick={onBack}>
            Back to trading
          </button>
          <button className="link" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      {refreshError && <p className="error" role="alert">{refreshError}</p>}

      <section className="panel">
        <h2>System health</h2>
        <div className="health-grid">
          <div><span>Overall</span><strong className={systemHealth?.status === "healthy" ? "bid" : "ask"}>{systemHealth?.status ?? "Checking…"}</strong></div>
          <div><span>PostgreSQL</span><strong>{systemHealth ? `${systemHealth.database.latencyMs} ms` : "…"}</strong></div>
          <div><span>Redis</span><strong>{systemHealth ? `${systemHealth.redis.latencyMs} ms` : "…"}</strong></div>
          <div><span>API uptime</span><strong>{systemHealth ? `${Math.floor(systemHealth.process.uptimeSeconds / 60)} min` : "…"}</strong></div>
          <div><span>Requests</span><strong>{systemHealth?.metrics?.requests ?? "…"}</strong></div>
          <div><span>Server errors</span><strong>{systemHealth?.metrics?.errors ?? "…"}</strong></div>
          <div><span>Average response</span><strong>{systemHealth?.metrics ? `${systemHealth.metrics.averageDurationMs} ms` : "…"}</strong></div>
          <div><span>Memory</span><strong>{systemHealth ? `${systemHealth.process.memoryMb} MB` : "…"}</strong></div>
        </div>
      </section>

      <section className="panel">
        <h2>Market</h2>
        <p className="lead">
          BTC/USDT is currently{" "}
          <strong className={market?.status === "PAUSED" ? "ask" : "bid"}>{market?.status ?? "…"}</strong>
          {market?.status === "PAUSED" ? " — new orders are rejected; open orders can still be cancelled." : "."}
        </p>
        <button type="button" onClick={toggleMarket} disabled={!market || marketBusy} className={market?.status === "ACTIVE" ? "sell" : "buy"}>
          {marketBusy ? "Working…" : market?.status === "ACTIVE" ? "Pause market" : "Resume market"}
        </button>
      </section>

      <section id="admin-users" className="panel">
        <h2>Users</h2>
        <div className="table-toolbar">
          <label>
            Search by email
            <input type="search" value={userSearch} onChange={(event) => { setUserSearch(event.target.value); setUserCursors([null]); }} placeholder="name@example.com" />
          </label>
          <p className="notice" role="status">{userTotal} user{userTotal === 1 ? "" : "s"}</p>
        </div>
        {users.length === 0 ? (
          <p className="notice">No users yet.</p>
        ) : userTotal === 0 ? (
          <p className="notice">No users match that email.</p>
        ) : (
          <table className="wide-table">
            <caption className="sr-only">Exchange users and administrator controls</caption>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>BTC</th>
                <th>USDT</th>
                <th>Trading</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const btc = user.wallets.find((w) => w.asset === "BTC");
                const usdt = user.wallets.find((w) => w.asset === "USDT");
                return (
                  <tr key={user.id}>
                    <td>{user.email}</td>
                    <td>{user.role}</td>
                    <td>{btc ? formatAmount(btc.availableBalance) : "0"}</td>
                    <td>{usdt ? formatAmount(usdt.availableBalance) : "0"}</td>
                    <td>{user.tradingDisabled ? "Disabled" : "Enabled"}</td>
                    <td><div className="table-actions">
                      <button type="button" className="link" disabled={togglingUserId === user.id} onClick={() => toggleTrading(user)}>
                        {togglingUserId === user.id ? "Working…" : user.tradingDisabled ? "Enable" : "Disable"}
                      </button>
                      <button type="button" className="link" onClick={() => openAdjustForm(user)}>
                        Adjust balance
                      </button>
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <Pagination page={currentUserPage} hasMore={userHasMore} onPrevious={() => setUserCursors((items) => items.slice(0, -1))} onNext={() => userNextCursor && setUserCursors((items) => [...items, userNextCursor])} label="User" />

        {adjustTarget && (
          <form className="auth admin-adjustment" onSubmit={submitAdjustment}>
            <h2>Adjust balance — {adjustTarget.email}</h2>
            <label>
              Asset
              <select value={adjustAsset} onChange={(e) => setAdjustAsset(e.target.value as Asset)}>
                <option value="USDT">USDT</option>
                <option value="BTC">BTC</option>
              </select>
            </label>
            <label>
              Amount (use a minus sign to debit, e.g. -50)
              <input value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} inputMode="decimal" placeholder="100" required />
            </label>
            <label>
              Reason
              <input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="Support ticket #123 correction" required />
            </label>
            {adjustError && <p className="error" role="alert">{adjustError}</p>}
            <button type="submit" disabled={adjustBusy}>
              {adjustBusy ? "Applying…" : "Apply adjustment"}
            </button>
            <button className="link" type="button" onClick={() => setAdjustUserId(null)}>
              Cancel
            </button>
          </form>
        )}
      </section>

      <section className="panel">
        <h2>Orders</h2>
        <div className="segmented admin-order-filters" role="group" aria-label="Filter orders by status">
          <button type="button" aria-pressed={orderStatusFilter === ""} className={orderStatusFilter === "" ? "active" : ""} onClick={() => { setOrderStatusFilter(""); setOrderCursors([null]); }}>
            All
          </button>
          {ORDER_STATUSES.map((status) => (
            <button key={status} type="button" aria-pressed={orderStatusFilter === status} className={orderStatusFilter === status ? "active" : ""} onClick={() => { setOrderStatusFilter(status); setOrderCursors([null]); }}>
              {status.replace("_", " ")}
            </button>
          ))}
        </div>
        {orders.length === 0 ? (
          <p className="notice">No orders.</p>
        ) : (
          <table className="wide-table">
            <caption className="sr-only">Exchange orders</caption>
            <thead>
              <tr>
                <th>User</th>
                <th>Side</th>
                <th>Type</th>
                <th>Price</th>
                <th>Quantity</th>
                <th>Filled</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>{order.userEmail}</td>
                  <td className={order.side === "BUY" ? "bid" : "ask"}>{order.side}</td>
                  <td>{order.type}</td>
                  <td>{order.price ? formatAmount(order.price) : "market"}</td>
                  <td>{formatAmount(order.quantity)}</td>
                  <td>{formatAmount(order.filledQuantity)}</td>
                  <td>{order.status.replace("_", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination page={currentOrderPage} hasMore={orderHasMore} onPrevious={() => setOrderCursors((items) => items.slice(0, -1))} onNext={() => orderNextCursor && setOrderCursors((items) => [...items, orderNextCursor])} label="Order" />
      </section>

      <section className="panel">
        <h2>Trades</h2>
        {trades.length === 0 ? (
          <p className="notice">No trades yet.</p>
        ) : (
          <table className="wide-table">
            <caption className="sr-only">Exchange trades and fees</caption>
            <thead>
              <tr>
                <th>Buyer</th>
                <th>Seller</th>
                <th>Price</th>
                <th>Quantity</th>
                <th>Buyer fee</th>
                <th>Seller fee</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => (
                <tr key={trade.id}>
                  <td>{trade.buyerEmail}</td>
                  <td>{trade.sellerEmail}</td>
                  <td>{formatAmount(trade.price)}</td>
                  <td>{formatAmount(trade.quantity)}</td>
                  <td>{formatAmount(trade.buyerFee)} BTC</td>
                  <td>{formatAmount(trade.sellerFee)} USDT</td>
                  <td>{formatDateTime(trade.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination page={currentTradePage} hasMore={tradeHasMore} onPrevious={() => setTradeCursors((items) => items.slice(0, -1))} onNext={() => tradeNextCursor && setTradeCursors((items) => [...items, tradeNextCursor])} label="Trade" />
      </section>

      <section className="panel">
        <h2>Audit log</h2>
        {audit.length === 0 ? (
          <p className="notice">No audit events yet.</p>
        ) : (
          <table className="wide-table">
            <caption className="sr-only">Administrator audit events</caption>
            <thead>
              <tr>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((event) => (
                <tr key={event.id}>
                  <td>{event.actorEmail ?? "system"}</td>
                  <td>{event.action}</td>
                  <td>{event.targetType ? `${event.targetType}:${event.targetId}` : "—"}</td>
                  <td>{formatDateTime(event.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination page={currentAuditPage} hasMore={auditHasMore} onPrevious={() => setAuditCursors((items) => items.slice(0, -1))} onNext={() => auditNextCursor && setAuditCursors((items) => [...items, auditNextCursor])} label="Audit log" />
      </section>
    </main>
  );
}
