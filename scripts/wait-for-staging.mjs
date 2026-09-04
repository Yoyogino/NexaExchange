import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_INTERVAL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 5_000;

export async function waitForStaging({
  baseUrl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  fetchImpl = fetch,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = Date.now,
} = {}) {
  const origin = String(baseUrl ?? "").replace(/\/$/, "");
  if (!origin.startsWith("https://")) throw new Error("STAGING_URL must be an HTTPS URL.");
  const deadline = now() + timeoutMs;
  let attempts = 0;
  let lastFailure = "no response";

  while (now() < deadline) {
    attempts += 1;
    try {
      const response = await fetchImpl(`${origin}/api/ready`, {
        redirect: "manual",
        signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, Math.max(1, deadline - now()))),
      });
      if (response.status === 200) {
        const readiness = await response.json();
        if (readiness.database === "ok" && readiness.redis === "ok") return { attempts };
        lastFailure = "dependencies are not ready";
      } else {
        lastFailure = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : "request failed";
    }
    if (now() < deadline) await delay(Math.min(intervalMs, Math.max(0, deadline - now())));
  }
  throw new Error(`Staging did not become ready within ${Math.ceil(timeoutMs / 1000)} seconds after ${attempts} attempts (${lastFailure}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await waitForStaging({ baseUrl: process.env.STAGING_URL });
  console.log(`Staging became ready after ${result.attempts} attempt${result.attempts === 1 ? "" : "s"}.`);
}
