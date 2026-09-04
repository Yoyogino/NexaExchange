// Thin typed wrapper around the demo exchange API. Every call that needs
// auth takes the bearer token explicitly rather than reading it from module
// state — keeps this file free of hidden global state and easy to test.

export type Asset = "BTC" | "USDT";
export type OrderSide = "BUY" | "SELL";
export type OrderType = "LIMIT" | "MARKET";
export type OrderStatus = "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED";

export interface Wallet {
  asset: Asset;
  availableBalance: string;
  lockedBalance: string;
}

export type UserRole = "TRADER" | "ADMIN";

export interface Account {
  user: { email: string; role: UserRole; tradingDisabled: boolean; demoGrantClaimed: boolean; emailVerified: boolean; twoFactorEnabled: boolean };
  wallets: Wallet[];
}

export interface Order {
  id: string;
  side: OrderSide;
  type: OrderType;
  price: string | null;
  quantity: string;
  filledQuantity: string;
  status: OrderStatus;
  createdAt: string;
}

export interface Trade {
  id: string;
  side: OrderSide;
  price: string;
  quantity: string;
  fee: string;
  feeAsset: Asset;
  createdAt: string;
}

export interface MarketLevel {
  price: string;
  quantity: string;
}
export interface MarketTrade { id: string; price: string; quantity: string; createdAt: string; }

export type MarketStatus = "ACTIVE" | "PAUSED";

export interface MarketSnapshot {
  marketId: string;
  status: MarketStatus;
  bestBid: string | null;
  bestAsk: string | null;
  bids: MarketLevel[];
  asks: MarketLevel[];
}

export interface PlaceOrderResult {
  orderId: string;
  status: OrderStatus;
  filledQuantity: string;
  trades: { id: string; price: string; quantity: string }[];
}

export class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) { super(message); this.code = code; }
}

async function apiFetch<T>(path: string, options: { token?: string; method?: string; body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  const csrfToken = document.cookie.split("; ").find((item) => item.startsWith("nexa_csrf="))?.split("=").slice(1).join("=");
  if (csrfToken && !["GET", "HEAD", "OPTIONS"].includes(options.method ?? (options.body !== undefined ? "POST" : "GET"))) headers["X-CSRF-Token"] = decodeURIComponent(csrfToken);
  const response = await fetch(path, {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: "same-origin",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error ?? "Something went wrong.", data.code);
  return data as T;
}

export const register = (email: string, password: string) =>
  apiFetch<Account>("/api/auth/register", { body: { email, password } });

export const login = (email: string, password: string, twoFactorCode?: string) =>
  apiFetch<Account>("/api/auth/login", { body: { email, password, twoFactorCode } });

export const getMe = (token: string) => apiFetch<Account>("/api/me", { token, method: "GET" });
export const claimDemoFunding = (token: string) => apiFetch<Account>("/api/demo-funding/claim", { token, body: {} });
export const logout = (token: string) => apiFetch<void>("/api/auth/logout", { token, method: "POST", body: {} });
export const requestEmailVerification = (token: string) => apiFetch<{ delivery: "email" | "local-demo"; demoCode?: string; expiresInMinutes: number }>("/api/auth/email-verification/request", { token, body: {} });
export const confirmEmailVerification = (token: string, code: string) => apiFetch<Account>("/api/auth/email-verification/confirm", { token, body: { code } });
export const requestPasswordReset = (email: string) => apiFetch<{ message: string; demoCode?: string }>("/api/auth/password-reset/request", { body: { email } });
export const confirmPasswordReset = (email: string, code: string, password: string) => apiFetch<{ message: string }>("/api/auth/password-reset/confirm", { body: { email, code, password } });
export interface UserSession { id: string; createdAt: string; lastSeenAt: string; expiresAt: string; ipAddress: string | null; userAgent: string | null; current: boolean; }
export interface LoginEvent { id: string; succeeded: boolean; ipAddress: string | null; userAgent: string | null; createdAt: string; }
export const setupTwoFactor = (token: string) => apiFetch<{ secret: string; provisioningUri: string }>("/api/security/2fa/setup", { token, body: {} });
export const confirmTwoFactor = (token: string, code: string) => apiFetch<{ recoveryCodes: string[]; account: Account }>("/api/security/2fa/confirm", { token, body: { code } });
export const regenerateRecoveryCodes = (token: string, code: string) => apiFetch<{ recoveryCodes: string[] }>("/api/security/2fa/recovery-codes", { token, body: { code } });
export const disableTwoFactor = (token: string, code: string) => apiFetch<Account>("/api/security/2fa/disable", { token, body: { code } });
export const getSessions = (token: string) => apiFetch<UserSession[]>("/api/security/sessions", { token, method: "GET" });
export const revokeSession = (token: string, id: string) => apiFetch<void>(`/api/security/sessions/${id}`, { token, method: "DELETE" });
export const getLoginHistory = (token: string) => apiFetch<LoginEvent[]>("/api/security/login-history", { token, method: "GET" });

export const getMarket = () => apiFetch<MarketSnapshot>("/api/market", { method: "GET" });
export const getMarketTrades = () => apiFetch<MarketTrade[]>("/api/market/trades", { method: "GET" });

export const placeOrder = (token: string, order: { side: OrderSide; type: OrderType; price?: string; quantity: string }) =>
  apiFetch<PlaceOrderResult>("/api/orders", { token, body: order, idempotencyKey: crypto.randomUUID() });

export const cancelOrder = (token: string, orderId: string) =>
  apiFetch<{ orderId: string; status: OrderStatus }>(`/api/orders/${orderId}`, { token, method: "DELETE" });

export const getOpenOrders = (token: string) => apiFetch<Order[]>("/api/orders", { token, method: "GET" });

export const getOrderHistory = (token: string) => apiFetch<Order[]>("/api/orders/history", { token, method: "GET" });

export const getTrades = (token: string) => apiFetch<Trade[]>("/api/trades", { token, method: "GET" });

// --- Admin -------------------------------------------------------------
// Every function below hits /api/admin/*, which 403s for non-ADMIN users
// server-side regardless of what the UI shows — the role check in
// AdminPanel.tsx is a UX convenience, not the actual access control.

export interface AdminUser {
  id: string;
  email: string;
  role: UserRole;
  tradingDisabled: boolean;
  createdAt: string;
  wallets: Wallet[];
}

export interface AdminOrder extends Order {
  userId: string;
  userEmail: string;
  updatedAt: string;
}

export interface AdminTrade {
  id: string;
  price: string;
  quantity: string;
  buyerFee: string;
  sellerFee: string;
  createdAt: string;
  buyerId: string;
  buyerEmail: string;
  sellerId: string;
  sellerEmail: string;
}

export interface AuditEvent {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actorEmail: string | null;
}

export interface SystemHealth {
  status: "healthy";
  checkedAt: string;
  database: { status: string; latencyMs: number };
  redis: { status: string; latencyMs: number };
  process: { uptimeSeconds: number; memoryMb: number };
  metrics: { requests: number; errors: number; errorRate: number; averageDurationMs: number; slowestMs: number; routes: { route: string; requests: number; errors: number; averageDurationMs: number }[] } | null;
}
export interface AdminPage<T> { items: T[]; total: number; nextCursor: string | null; hasMore: boolean; }

export const getAdminUsers = (token: string, options: { search?: string; cursor?: string | null; limit?: number } = {}) => {
  const query = new URLSearchParams({ limit: String(options.limit ?? 10) });
  if (options.search) query.set("search", options.search);
  if (options.cursor) query.set("cursor", options.cursor);
  return apiFetch<AdminPage<AdminUser>>(`/api/admin/users?${query}`, { token, method: "GET" });
};

export const getAdminOrders = (token: string, status: OrderStatus | undefined, cursor: string | null = null, limit = 12) => {
  const query = new URLSearchParams({ limit: String(limit) }); if (status) query.set("status", status); if (cursor) query.set("cursor", cursor);
  return apiFetch<AdminPage<AdminOrder>>(`/api/admin/orders?${query}`, { token, method: "GET" });
};

export const getAdminTrades = (token: string, cursor: string | null = null, limit = 12) => apiFetch<AdminPage<AdminTrade>>(`/api/admin/trades?${new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) })}`, { token, method: "GET" });

export const getAdminAudit = (token: string, cursor: string | null = null, limit = 12) => apiFetch<AdminPage<AuditEvent>>(`/api/admin/audit?${new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) })}`, { token, method: "GET" });

export const getAdminMarket = (token: string) => apiFetch<MarketSnapshot>("/api/admin/market", { token, method: "GET" });
export const getAdminSystemHealth = (token: string) => apiFetch<SystemHealth>("/api/admin/system-health", { token, method: "GET" });

export const pauseMarket = (token: string) => apiFetch<{ marketId: string; status: MarketStatus }>("/api/admin/market/pause", { token, body: {} });

export const resumeMarket = (token: string) => apiFetch<{ marketId: string; status: MarketStatus }>("/api/admin/market/resume", { token, body: {} });

export const setUserTrading = (token: string, userId: string, disabled: boolean) =>
  apiFetch<{ id: string; email: string; tradingDisabled: boolean }>(`/api/admin/users/${userId}/trading`, { token, body: { disabled } });

export const adjustUserBalance = (token: string, userId: string, adjustment: { asset: Asset; amount: string; reason: string }) =>
  apiFetch<{ userId: string; wallets: Wallet[] }>(`/api/admin/users/${userId}/adjust-balance`, { token, body: adjustment });
