const baseUrl = String(process.env.STAGING_URL ?? "").replace(/\/$/, "");
const monitoringToken = process.env.MONITORING_TOKEN;

if (!baseUrl.startsWith("https://")) throw new Error("STAGING_URL must be an HTTPS URL.");
if (!monitoringToken) throw new Error("MONITORING_TOKEN is required.");

async function request(path, options) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: "manual", ...options });
  return response;
}

function expectStatus(response, expected, label) {
  if (response.status !== expected) throw new Error(`${label}: expected HTTP ${expected}, received ${response.status}.`);
}

const health = await request("/api/health");
expectStatus(health, 200, "Health check");
if ((await health.json()).status !== "ok") throw new Error("Health response was not OK.");

const ready = await request("/api/ready");
expectStatus(ready, 200, "Readiness check");
const readiness = await ready.json();
if (readiness.database !== "ok" || readiness.redis !== "ok") throw new Error("A required dependency is not ready.");

const page = await request("/");
expectStatus(page, 200, "Web application");
for (const [header, expected] of [
  ["strict-transport-security", "max-age="],
  ["content-security-policy", "default-src 'self'"],
  ["x-frame-options", "DENY"],
  ["x-content-type-options", "nosniff"],
]) {
  if (!page.headers.get(header)?.includes(expected)) throw new Error(`Missing or invalid ${header} header.`);
}

const hiddenMetrics = await request("/metrics");
expectStatus(hiddenMetrics, 404, "Unauthenticated metrics check");
const metrics = await request("/metrics", { headers: { authorization: `Bearer ${monitoringToken}` } });
expectStatus(metrics, 200, "Authenticated metrics check");
if (!(await metrics.text()).includes("nexa_up 1")) throw new Error("Metrics output did not report the API as up.");

console.log("Staging validation passed: HTTPS app, dependencies, security headers, and protected metrics are healthy.");
