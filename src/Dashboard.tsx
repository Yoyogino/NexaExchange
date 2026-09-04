import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  Account,
  MarketSnapshot,
  Order,
  OrderSide,
  OrderType,
  Trade,
  MarketTrade,
  cancelOrder,
  getMarket,
  getMe,
  getOpenOrders,
  getTrades,
  getMarketTrades,
  placeOrder,
  claimDemoFunding,
  requestEmailVerification,
  confirmEmailVerification,
  confirmTwoFactor,
  disableTwoFactor,
  regenerateRecoveryCodes,
  getLoginHistory,
  getSessions,
  revokeSession,
  setupTwoFactor,
  LoginEvent,
  UserSession,
} from "./api";

// Simple polling instead of the WebSocket push PRODUCT_REQUIREMENTS.md
// describes for market data — documented simplification: every 2s the
// dashboard re-fetches market/orders/trades/balances while mounted. Good
// enough for a demo with a handful of users; a real deployment would push
// updates instead of every client polling the API.
const POLL_INTERVAL_MS = 2000;

const formatAmount = (value: string) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 8 });

function walletFor(account: Account, asset: "BTC" | "USDT") {
  return account.wallets.find((w) => w.asset === asset) ?? { asset, availableBalance: "0", lockedBalance: "0" };
}

export function Dashboard({ token, account, onAccountChange, onSignOut, onOpenAdmin }: { token: string; account: Account; onAccountChange: (account: Account) => void; onSignOut: () => void; onOpenAdmin?: () => void }) {
  const [market, setMarket] = useState<MarketSnapshot | null>(null);
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [marketTrades, setMarketTrades] = useState<MarketTrade[]>([]);
  const [notifications, setNotifications] = useState<string[]>([]);
  const knownTradeIds = useRef(new Set<string>());
  const [refreshError, setRefreshError] = useState("");

  const [side, setSide] = useState<OrderSide>("BUY");
  const [type, setType] = useState<OrderType>("LIMIT");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [formError, setFormError] = useState("");
  const [formNotice, setFormNotice] = useState("");
  const [placing, setPlacing] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [demoCode, setDemoCode] = useState("");
  const [verificationRequested, setVerificationRequested] = useState(false);
  const [twoFactorSecret, setTwoFactorSecret] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [loginHistory, setLoginHistory] = useState<LoginEvent[]>([]);

  const refreshMarket = useCallback(async () => {
    try {
      const [nextMarket, nextMarketTrades] = await Promise.all([getMarket(), getMarketTrades()]);
      setMarket(nextMarket);
      setMarketTrades(nextMarketTrades);
      setRefreshError("");
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "Could not refresh market data.");
    }
  }, []);

  const refreshAccount = useCallback(async () => {
    try {
      const [nextOrders, nextTrades, nextAccount] = await Promise.all([getOpenOrders(token), getTrades(token), getMe(token)]);
      setOpenOrders(nextOrders);
      setTrades(nextTrades);
      const newTrades = nextTrades.filter((trade) => knownTradeIds.current.has(trade.id) === false);
      if (knownTradeIds.current.size > 0 && newTrades.length) setNotifications((current) => [`Trade filled: ${formatAmount(newTrades[0].quantity)} BTC at ${formatAmount(newTrades[0].price)} USDT`, ...current].slice(0, 4));
      knownTradeIds.current = new Set(nextTrades.map((trade) => trade.id));
      onAccountChange(nextAccount);
      setRefreshError("");
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "Could not refresh account data.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshMarket(), refreshAccount()]);
  }, [refreshMarket, refreshAccount]);

  useEffect(() => {
    refreshAll();
    const events = new EventSource("/api/events");
    events.addEventListener("market", refreshMarket);
    events.addEventListener("account", refreshAccount);
    const timer = setInterval(refreshAll, POLL_INTERVAL_MS * 15);
    return () => { events.close(); clearInterval(timer); };
  }, [refreshAll, refreshMarket, refreshAccount]);

  async function submitOrder(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    setFormNotice("");
    setPlacing(true);
    try {
      const result = await placeOrder(token, { side, type, quantity, ...(type === "LIMIT" ? { price } : {}) });
      const filled = Number(result.filledQuantity);
      if (result.status === "FILLED") setFormNotice(`Filled ${formatAmount(result.filledQuantity)} BTC across ${result.trades.length} trade${result.trades.length === 1 ? "" : "s"}.`);
      else if (filled > 0) setFormNotice(`Filled ${formatAmount(result.filledQuantity)} BTC so far — order is ${result.status.toLowerCase().replace("_", " ")}.`);
      else if (result.status === "CANCELLED") setFormNotice("No matching liquidity was available — order closed unfilled.");
      else setFormNotice("Order placed and resting in the order book.");
      setQuantity("");
      if (type === "LIMIT") setPrice("");
      await refreshAll();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not place order.");
    } finally {
      setPlacing(false);
    }
  }

  async function handleCancel(orderId: string) {
    setCancellingId(orderId);
    setFormError("");
    try {
      await cancelOrder(token, orderId);
      await refreshAll();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not cancel order.");
    } finally {
      setCancellingId(null);
    }
  }

  async function claimFunds() {
    setClaiming(true); setFormError("");
    try { onAccountChange(await claimDemoFunding(token)); } catch (error) { setFormError(error instanceof Error ? error.message : "Could not claim demo funds."); } finally { setClaiming(false); }
  }

  async function requestVerification() {
    try { const result = await requestEmailVerification(token); setDemoCode(result.demoCode ?? ""); setVerificationRequested(true); setFormNotice(result.delivery === "email" ? "Verification code sent to your email." : "Demo verification code created."); }
    catch (error) { setFormError(error instanceof Error ? error.message : "Could not create a verification code."); }
  }

  async function verifyEmail() {
    try { onAccountChange(await confirmEmailVerification(token, verificationCode)); setDemoCode(""); setVerificationCode(""); setVerificationRequested(false); }
    catch (error) { setFormError(error instanceof Error ? error.message : "Could not verify email."); }
  }

  async function beginTwoFactor() { try { const result = await setupTwoFactor(token); setTwoFactorSecret(result.secret); } catch (error) { setFormError(error instanceof Error ? error.message : "Could not start 2FA setup."); } }
  async function finishTwoFactor() { try { const result = await confirmTwoFactor(token, twoFactorCode); onAccountChange(result.account); setRecoveryCodes(result.recoveryCodes); setTwoFactorSecret(""); } catch (error) { setFormError(error instanceof Error ? error.message : "Could not enable 2FA."); } }
  async function refreshRecoveryCodes() { try { const result = await regenerateRecoveryCodes(token, twoFactorCode); setRecoveryCodes(result.recoveryCodes); setTwoFactorCode(""); } catch (error) { setFormError(error instanceof Error ? error.message : "Could not regenerate recovery codes."); } }
  async function turnOffTwoFactor() { try { onAccountChange(await disableTwoFactor(token, twoFactorCode)); setRecoveryCodes([]); setTwoFactorCode(""); } catch (error) { setFormError(error instanceof Error ? error.message : "Could not disable 2FA."); } }
  async function loadSecurityActivity() { try { const [nextSessions, nextHistory] = await Promise.all([getSessions(token), getLoginHistory(token)]); setSessions(nextSessions); setLoginHistory(nextHistory); } catch (error) { setFormError(error instanceof Error ? error.message : "Could not load security activity."); } }
  async function removeSession(id: string) { try { await revokeSession(token, id); await loadSecurityActivity(); } catch (error) { setFormError(error instanceof Error ? error.message : "Could not revoke session."); } }

  const btc = walletFor(account, "BTC");
  const usdt = walletFor(account, "USDT");

  return (
    <main id="main-content" className="dashboard">
      <a className="skip-link" href="#order-form">Skip to order form</a>
      <header className="dash-header">
        <div>
          <p className="eyebrow">SIMULATED EXCHANGE</p>
          <h1 className="dash-title">BTC/USDT</h1>
          <p className="lead">{account.user.email} · demo funds only</p>
        </div>
        <div>
          {account.user.role === "ADMIN" && onOpenAdmin && (
            <button className="link" type="button" onClick={onOpenAdmin}>
              Admin panel
            </button>
          )}
          <button className="link" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      {account.user.tradingDisabled && <p className="error">Trading has been disabled for this account. Contact support if you believe this is a mistake.</p>}
      {!account.user.demoGrantClaimed && <p className="notice-inline">This legacy demo account has no initial funds. <button type="button" onClick={claimFunds} disabled={claiming}>{claiming ? "Claiming…" : "Claim 1 BTC + 10,000 USDT"}</button></p>}
      {!account.user.emailVerified && <section className="security-banner" aria-labelledby="verify-email-heading"><strong id="verify-email-heading">Verify your email</strong><p>{verificationRequested && !demoCode ? "Check your inbox for the six-digit code." : "Local development displays the code here; deployed environments send it by email."}</p>{!verificationRequested ? <button type="button" onClick={requestVerification}>Send verification code</button> : <>{demoCode && <p>Demo code: <strong>{demoCode}</strong></p>}<input aria-label="Verification code" value={verificationCode} onChange={(event) => setVerificationCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6-digit code" /><button type="button" onClick={verifyEmail}>Verify</button></>}</section>}

      <section className="wallets">
        <article className="wallet">
          <span>BTC</span>
          <strong>{formatAmount(btc.availableBalance)}</strong>
          <small>Available{Number(btc.lockedBalance) > 0 ? ` · ${formatAmount(btc.lockedBalance)} locked` : ""}</small>
        </article>
        <article className="wallet">
          <span>USDT</span>
          <strong>{formatAmount(usdt.availableBalance)}</strong>
          <small>Available{Number(usdt.lockedBalance) > 0 ? ` · ${formatAmount(usdt.lockedBalance)} locked` : ""}</small>
        </article>
      </section>

      <details className="panel security-panel"><summary>Account security</summary><p>Email: {account.user.emailVerified ? "Verified" : "Not verified"} · Two-factor: {account.user.twoFactorEnabled ? "Enabled" : "Disabled"}</p>{account.user.emailVerified && !account.user.twoFactorEnabled && !twoFactorSecret && <button type="button" onClick={beginTwoFactor}>Set up authenticator 2FA</button>}{twoFactorSecret && <div className="security-setup"><p>In your authenticator app, add this setup key:</p><code>{twoFactorSecret}</code><input aria-label="Authenticator code" value={twoFactorCode} onChange={(event) => setTwoFactorCode(event.target.value)} placeholder="6-digit authenticator code" /><button type="button" onClick={finishTwoFactor}>Confirm and enable</button></div>}{account.user.twoFactorEnabled && <div className="security-setup"><label>Confirm with authenticator or recovery code<input value={twoFactorCode} onChange={(event) => setTwoFactorCode(event.target.value)} /></label><div className="security-actions"><button type="button" onClick={refreshRecoveryCodes} disabled={!twoFactorCode}>Generate new recovery codes</button><button className="danger-button" type="button" onClick={turnOffTwoFactor} disabled={!twoFactorCode}>Disable two-factor</button></div></div>}{recoveryCodes.length > 0 && <div className="recovery-codes"><strong>Save these one-time recovery codes now. Older codes no longer work:</strong>{recoveryCodes.map((code) => <code key={code}>{code}</code>)}</div>}<button className="link" type="button" onClick={loadSecurityActivity}>Show sessions and login history</button>{sessions.map((session) => <p key={session.id}>{session.current ? "Current session" : "Other session"} · active {new Date(session.lastSeenAt).toLocaleString()} / expires {new Date(session.expiresAt).toLocaleString()} {!session.current && <button className="link" type="button" onClick={() => removeSession(session.id)}>Revoke</button>}</p>)}{loginHistory.slice(0, 8).map((event) => <p key={event.id}>{event.succeeded ? "Successful" : "Failed"} login · {new Date(event.createdAt).toLocaleString()}</p>)}</details>

      {refreshError && <p className="error" role="alert">{refreshError}</p>}
      {notifications.length > 0 && <section className="notifications" aria-live="polite">{notifications.map((notice, index) => <p key={`${notice}-${index}`}>{notice}</p>)}</section>}

      <section className="panel chart-panel"><h2>Recent market activity <span className="live-dot">Live</span></h2><MarketChart trades={marketTrades} /><div className="trade-tape">{marketTrades.slice(-6).reverse().map((trade) => <span key={trade.id}>{formatAmount(trade.price)} · {formatAmount(trade.quantity)} BTC</span>)}</div></section>

      <div className="trade-grid">
        <section id="order-form" className="panel order-form" aria-labelledby="order-form-heading">
          <h2 id="order-form-heading">Place an order</h2>
          <form onSubmit={submitOrder}>
            <div className="segmented" role="group" aria-label="Order side">
              <button type="button" aria-pressed={side === "BUY"} className={side === "BUY" ? "active buy" : ""} onClick={() => setSide("BUY")}>
                Buy
              </button>
              <button type="button" aria-pressed={side === "SELL"} className={side === "SELL" ? "active sell" : ""} onClick={() => setSide("SELL")}>
                Sell
              </button>
            </div>
            <div className="segmented" role="group" aria-label="Order type">
              <button type="button" aria-pressed={type === "LIMIT"} className={type === "LIMIT" ? "active" : ""} onClick={() => setType("LIMIT")}>
                Limit
              </button>
              <button type="button" aria-pressed={type === "MARKET"} className={type === "MARKET" ? "active" : ""} onClick={() => setType("MARKET")}>
                Market
              </button>
            </div>
            {type === "LIMIT" && (
              <label>
                Price (USDT)
                <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="50000" required />
              </label>
            )}
            <label>
              Quantity (BTC)
              <input value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="decimal" placeholder="0.1" required />
            </label>
            {formError && <p className="error" role="alert">{formError}</p>}
            {formNotice && <p className="notice-inline" role="status">{formNotice}</p>}
            <button type="submit" disabled={placing} className={side === "BUY" ? "buy" : "sell"}>
              {placing ? "Placing…" : `${side === "BUY" ? "Buy" : "Sell"} BTC`}
            </button>
          </form>
        </section>

        <section className="panel order-book">
          <h2>Order book</h2>
          <div className="book-columns">
            <div>
              <p className="book-label bid">Bids</p>
              <table>
                <caption className="sr-only">BTC buy orders, highest price first</caption>
                <thead className="sr-only"><tr><th scope="col">Price in USDT</th><th scope="col">Quantity in BTC</th></tr></thead>
                <tbody>
                  {(market?.bids ?? []).slice(0, 10).map((level) => (
                    <tr key={level.price}>
                      <td className="bid">{formatAmount(level.price)}</td>
                      <td>{formatAmount(level.quantity)}</td>
                    </tr>
                  ))}
                  {market && market.bids.length === 0 && (
                    <tr>
                      <td colSpan={2} className="empty">
                        No bids
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div>
              <p className="book-label ask">Asks</p>
              <table>
                <caption className="sr-only">BTC sell orders, lowest price first</caption>
                <thead className="sr-only"><tr><th scope="col">Price in USDT</th><th scope="col">Quantity in BTC</th></tr></thead>
                <tbody>
                  {(market?.asks ?? []).slice(0, 10).map((level) => (
                    <tr key={level.price}>
                      <td className="ask">{formatAmount(level.price)}</td>
                      <td>{formatAmount(level.quantity)}</td>
                    </tr>
                  ))}
                  {market && market.asks.length === 0 && (
                    <tr>
                      <td colSpan={2} className="empty">
                        No asks
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      <section className="panel">
        <h2>Open orders</h2>
        {openOrders.length === 0 ? (
          <p className="notice">No open orders.</p>
        ) : (
          <table className="wide-table">
            <caption className="sr-only">Your open BTC USDT orders</caption>
            <thead>
              <tr>
                <th>Side</th>
                <th>Type</th>
                <th>Price</th>
                <th>Quantity</th>
                <th>Filled</th>
                <th>Status</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {openOrders.map((order) => (
                <tr key={order.id}>
                  <td className={order.side === "BUY" ? "bid" : "ask"}>{order.side}</td>
                  <td>{order.type}</td>
                  <td>{order.price ? formatAmount(order.price) : "market"}</td>
                  <td>{formatAmount(order.quantity)}</td>
                  <td>{formatAmount(order.filledQuantity)}</td>
                  <td>{order.status.replace("_", " ")}</td>
                  <td>
                    <button type="button" className="link" disabled={cancellingId === order.id} onClick={() => handleCancel(order.id)}>
                      {cancellingId === order.id ? "Cancelling…" : "Cancel"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Trade history</h2>
        {trades.length === 0 ? (
          <p className="notice">No trades yet.</p>
        ) : (
          <table className="wide-table">
            <caption className="sr-only">Your completed BTC USDT trades</caption>
            <thead>
              <tr>
                <th>Side</th>
                <th>Price</th>
                <th>Quantity</th>
                <th>Fee</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => (
                <tr key={trade.id}>
                  <td className={trade.side === "BUY" ? "bid" : "ask"}>{trade.side}</td>
                  <td>{formatAmount(trade.price)}</td>
                  <td>{formatAmount(trade.quantity)}</td>
                  <td>{formatAmount(trade.fee)} {trade.feeAsset}</td>
                  <td>{new Date(trade.createdAt).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="notice">These are simulated funds on a simulated market. Real deposits and withdrawals are unavailable.</p>
    </main>
  );
}

function MarketChart({ trades }: { trades: MarketTrade[] }) {
  if (trades.length < 2) return <p className="notice">Trades will appear here as the market executes.</p>;
  const prices = trades.map((trade) => Number(trade.price)); const min = Math.min(...prices); const max = Math.max(...prices); const range = max - min || 1;
  const points = prices.map((price, index) => `${(index / (prices.length - 1)) * 100},${90 - ((price - min) / range) * 80}`).join(" ");
  return <svg className="market-chart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Recent BTC USDT price chart"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>;
}
