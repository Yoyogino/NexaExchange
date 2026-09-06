import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const baseUrl = new URL(process.argv[2] || process.env.STAGING_URL);
if (baseUrl.protocol !== "https:") throw new Error("STAGING_URL must use HTTPS.");

function decodeBase32(value) {
  let bits = "";
  for (const char of value.replace(/=+$/, "").toUpperCase()) bits += ALPHABET.indexOf(char).toString(2).padStart(5, "0");
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

function currentTotp(secret) {
  const counter = Math.floor(Date.now() / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", decodeBase32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function responseCookies(response) {
  const values = response.headers.getSetCookie?.() ?? [];
  return Object.fromEntries(values.map((value) => {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    return [pair.slice(0, separator), pair.slice(separator + 1)];
  }));
}

function cookieHeader(cookies) {
  return Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; ");
}

async function request(path, { method = "GET", cookies, body, headers = {} } = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookies ? { cookie: cookieHeader(cookies) } : {}),
      ...(cookies?.nexa_csrf && method !== "GET" ? { "x-csrf-token": cookies.nexa_csrf } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let payload = null;
  if (response.status !== 204) payload = await response.json().catch(() => null);
  return { response, payload, cookies: { ...(cookies ?? {}), ...responseCookies(response) } };
}

const suffix = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
const traderEmail = `security-controls-trader-${suffix}@example.test`;
const adminEmail = `security-controls-admin-${suffix}@example.test`;
const traderPassword = `${crypto.randomBytes(24).toString("base64url")}Aa1!`;
const adminPassword = `${crypto.randomBytes(24).toString("base64url")}Aa1!`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let traderCookies;
let adminCookies;
let traderId;
let adminId;
let openOrderId;
let initialMarketStatus;

try {
  const traderRegistration = await request("/api/auth/register", { method: "POST", body: { email: traderEmail, password: traderPassword } });
  assert.equal(traderRegistration.response.status, 201);
  traderCookies = traderRegistration.cookies;

  const adminRegistration = await request("/api/auth/register", { method: "POST", body: { email: adminEmail, password: adminPassword } });
  assert.equal(adminRegistration.response.status, 201);
  adminCookies = adminRegistration.cookies;

  const identities = await pool.query(
    `UPDATE users
        SET email_verified = true,
            role = CASE WHEN email = $2 THEN 'ADMIN' ELSE role END
      WHERE email IN ($1, $2)
      RETURNING id, email`,
    [traderEmail, adminEmail],
  );
  traderId = identities.rows.find((row) => row.email === traderEmail)?.id;
  adminId = identities.rows.find((row) => row.email === adminEmail)?.id;
  assert.ok(traderId && adminId);

  const forbidden = await request("/api/admin/system-health", { cookies: traderCookies });
  assert.equal(forbidden.response.status, 403);

  const adminHealth = await request("/api/admin/system-health", { cookies: adminCookies });
  assert.equal(adminHealth.response.status, 200);
  assert.equal(adminHealth.payload?.status, "healthy");

  const market = await request("/api/admin/market", { cookies: adminCookies });
  assert.equal(market.response.status, 200);
  initialMarketStatus = market.payload?.status;
  if (initialMarketStatus === "PAUSED") {
    const resumed = await request("/api/admin/market/resume", { method: "POST", cookies: adminCookies, body: {} });
    assert.equal(resumed.response.status, 200);
  }

  const placed = await request("/api/orders", {
    method: "POST",
    cookies: traderCookies,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: { side: "BUY", type: "LIMIT", price: "1000", quantity: "0.01" },
  });
  assert.equal(placed.response.status, 201, placed.payload?.error || "Order placement failed.");
  openOrderId = placed.payload?.orderId;
  assert.ok(openOrderId);

  const cancelled = await request(`/api/orders/${openOrderId}`, { method: "DELETE", cookies: traderCookies });
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.payload?.status, "CANCELLED");
  openOrderId = null;

  const disabled = await request(`/api/admin/users/${traderId}/trading`, {
    method: "POST",
    cookies: adminCookies,
    body: { disabled: true },
  });
  assert.equal(disabled.response.status, 200);
  assert.equal(disabled.payload?.tradingDisabled, true);

  const blockedOrder = await request("/api/orders", {
    method: "POST",
    cookies: traderCookies,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: { side: "BUY", type: "LIMIT", price: "1000", quantity: "0.01" },
  });
  assert.equal(blockedOrder.response.status, 403);

  const enabled = await request(`/api/admin/users/${traderId}/trading`, {
    method: "POST",
    cookies: adminCookies,
    body: { disabled: false },
  });
  assert.equal(enabled.response.status, 200);
  assert.equal(enabled.payload?.tradingDisabled, false);

  const paused = await request("/api/admin/market/pause", { method: "POST", cookies: adminCookies, body: {} });
  assert.equal(paused.response.status, 200);
  assert.equal(paused.payload?.status, "PAUSED");
  const resumed = await request("/api/admin/market/resume", { method: "POST", cookies: adminCookies, body: {} });
  assert.equal(resumed.response.status, 200);
  assert.equal(resumed.payload?.status, "ACTIVE");

  const setup = await request("/api/security/2fa/setup", { method: "POST", cookies: traderCookies, body: {} });
  assert.equal(setup.response.status, 200);
  assert.ok(setup.payload?.secret);

  const confirmation = await request("/api/security/2fa/confirm", {
    method: "POST",
    cookies: traderCookies,
    body: { code: currentTotp(setup.payload.secret) },
  });
  assert.equal(confirmation.response.status, 200);
  assert.equal(confirmation.payload?.account?.user?.twoFactorEnabled, true);
  assert.equal(confirmation.payload?.recoveryCodes?.length, 8);

  const secondFactorRequired = await request("/api/auth/login", {
    method: "POST",
    body: { email: traderEmail, password: traderPassword },
  });
  assert.equal(secondFactorRequired.response.status, 401);
  assert.equal(secondFactorRequired.payload?.code, "TWO_FACTOR_REQUIRED");

  const recoveryLogin = await request("/api/auth/login", {
    method: "POST",
    body: {
      email: traderEmail,
      password: traderPassword,
      twoFactorCode: confirmation.payload.recoveryCodes[0],
    },
  });
  assert.equal(recoveryLogin.response.status, 200);

  console.log(JSON.stringify({
    nonAdminRejected: true,
    adminHealthPassed: true,
    orderCancellationPassed: true,
    tradingDisableRestorePassed: true,
    marketPauseResumePassed: true,
    twoFactorEnablePassed: true,
    secondFactorRequiredOnLogin: true,
    recoveryCodeLoginPassed: true,
  }));
} finally {
  if (openOrderId && traderCookies) {
    await request(`/api/orders/${openOrderId}`, { method: "DELETE", cookies: traderCookies }).catch(() => {});
  }
  if (traderId) await pool.query("UPDATE users SET trading_disabled=false WHERE id=$1", [traderId]).catch(() => {});
  if (adminId) await pool.query("UPDATE users SET role='TRADER' WHERE id=$1", [adminId]).catch(() => {});
  if (initialMarketStatus === "PAUSED") {
    await pool.query("UPDATE markets SET status='PAUSED' WHERE id='BTC-USDT'").catch(() => {});
  } else if (initialMarketStatus === "ACTIVE") {
    await pool.query("UPDATE markets SET status='ACTIVE' WHERE id='BTC-USDT'").catch(() => {});
  }
  await pool.query(
    "UPDATE sessions SET revoked_at=now() WHERE user_id IN (SELECT id FROM users WHERE email IN ($1,$2)) AND revoked_at IS NULL",
    [traderEmail, adminEmail],
  ).catch(() => {});
  await pool.end();
}
