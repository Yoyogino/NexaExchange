import { pathToFileURL } from "node:url";

function expectStatus(response, expected, label) {
  if (response.status !== expected) throw new Error(`${label}: expected HTTP ${expected}, received ${response.status}.`);
}

class CookieJar {
  constructor() { this.cookies = new Map(); }
  capture(response) {
    const values = response.headers.getSetCookie?.() ?? [];
    for (const value of values) {
      const pair = value.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
  header() { return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "); }
  get(name) { return this.cookies.get(name); }
}

export async function runStagingSmoke({ baseUrl, email, password, fetchImpl = fetch }) {
  const origin = String(baseUrl ?? "").replace(/\/$/, "");
  if (!origin.startsWith("https://")) throw new Error("Staging smoke tests require an HTTPS URL.");
  const jar = new CookieJar();

  async function request(path, { method = "GET", body, csrf = false } = {}) {
    const headers = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (jar.header()) headers.cookie = jar.header();
    if (csrf) {
      const token = jar.get("nexa_csrf");
      if (!token) throw new Error("Staging session did not provide a CSRF cookie.");
      headers["x-csrf-token"] = decodeURIComponent(token);
    }
    const response = await fetchImpl(`${origin}${path}`, { method, headers, redirect: "manual", body: body === undefined ? undefined : JSON.stringify(body) });
    jar.capture(response);
    return response;
  }

  let authenticated = await request("/api/auth/register", { method: "POST", body: { email, password } });
  if (authenticated.status === 409) authenticated = await request("/api/auth/login", { method: "POST", body: { email, password } });
  expectStatus(authenticated, authenticated.status === 201 ? 201 : 200, "Smoke-account authentication");

  const me = await request("/api/me");
  expectStatus(me, 200, "Authenticated account check");
  const account = await me.json();
  if (account.user?.email !== email.toLowerCase()) throw new Error("Authenticated smoke account did not match the configured email.");
  if (!Array.isArray(account.wallets) || !account.wallets.some((wallet) => wallet.asset === "BTC") || !account.wallets.some((wallet) => wallet.asset === "USDT")) {
    throw new Error("Smoke account is missing its simulated wallets.");
  }

  for (const [path, label] of [["/api/market", "Market"], ["/api/orders", "Orders"], ["/api/trades", "Trades"]]) {
    expectStatus(await request(path), 200, `${label} API check`);
  }
  expectStatus(await request("/api/auth/logout", { method: "POST", csrf: true }), 204, "Logout check");
  return { email: account.user.email };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runStagingSmoke({
    baseUrl: process.env.STAGING_URL,
    email: process.env.STAGING_SMOKE_EMAIL,
    password: process.env.STAGING_SMOKE_PASSWORD,
  });
  console.log(`Staging account smoke test passed for ${result.email}.`);
}
