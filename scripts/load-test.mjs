import { fileURLToPath } from "node:url";
import path from "node:path";

const READ_PATHS = ["/api/health", "/api/ready", "/api/market", "/api/market/trades"];

export function parseLoadOptions(environment) {
  if (environment.LOAD_TEST_CONFIRM !== "simulated-only") throw new Error("Set LOAD_TEST_CONFIRM=simulated-only to confirm this is not a real-money system.");
  const baseUrl = new URL(environment.LOAD_TEST_URL ?? "http://127.0.0.1:3001");
  const local = ["localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname);
  if (!local && baseUrl.protocol !== "https:") throw new Error("Non-local load tests require HTTPS.");
  const concurrency = Number(environment.LOAD_TEST_CONCURRENCY ?? 10);
  const durationSeconds = Number(environment.LOAD_TEST_DURATION_SECONDS ?? 30);
  const streamCount = Number(environment.LOAD_TEST_STREAMS ?? 5);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100) throw new Error("LOAD_TEST_CONCURRENCY must be an integer from 1 to 100.");
  if (!Number.isInteger(durationSeconds) || durationSeconds < 5 || durationSeconds > 1800) throw new Error("LOAD_TEST_DURATION_SECONDS must be an integer from 5 to 1800.");
  if (!Number.isInteger(streamCount) || streamCount < 0 || streamCount > 50) throw new Error("LOAD_TEST_STREAMS must be an integer from 0 to 50.");
  return { baseUrl: baseUrl.href.replace(/\/$/, ""), concurrency, durationSeconds, streamCount, cookie: environment.LOAD_TEST_COOKIE ?? "" };
}

export function summarizeLoad(results) {
  const latencies = [...results.latencies].sort((a, b) => a - b);
  const percentile = (fraction) => latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * fraction) - 1)] : 0;
  const total = results.successes + results.failures;
  return {
    requests: total,
    successes: results.successes,
    failures: results.failures,
    errorRate: total ? results.failures / total : 1,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    liveEvents: results.liveEvents,
    streamReconnects: results.streamReconnects,
  };
}

async function runLoadTest(options) {
  const deadline = Date.now() + options.durationSeconds * 1000;
  const results = { successes: 0, failures: 0, latencies: [], liveEvents: 0, streamReconnects: 0 };

  async function requestWorker(worker) {
    let sequence = worker;
    while (Date.now() < deadline) {
      const started = performance.now();
      try {
        const response = await fetch(`${options.baseUrl}${READ_PATHS[sequence++ % READ_PATHS.length]}`, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await response.arrayBuffer();
        results.successes += 1;
        results.latencies.push(Math.round(performance.now() - started));
      } catch { results.failures += 1; }
    }
  }

  async function streamWorker() {
    while (Date.now() < deadline) {
      const controller = new AbortController();
      const remaining = Math.max(1, deadline - Date.now());
      const timeout = setTimeout(() => controller.abort(), remaining);
      try {
        const response = await fetch(`${options.baseUrl}/api/events`, { headers: { cookie: options.cookie }, signal: controller.signal });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        const reader = response.body.getReader();
        while (Date.now() < deadline) {
          const { value, done } = await reader.read();
          if (done) break;
          results.liveEvents += new TextDecoder().decode(value).split("\n\n").filter((item) => item.startsWith("event:")).length;
        }
      } catch (error) {
        if (Date.now() < deadline && error?.name !== "AbortError") results.streamReconnects += 1;
      } finally { clearTimeout(timeout); controller.abort(); }
    }
  }

  const jobs = Array.from({ length: options.concurrency }, (_, index) => requestWorker(index));
  if (options.cookie) jobs.push(...Array.from({ length: options.streamCount }, () => streamWorker()));
  await Promise.all(jobs);
  return summarizeLoad(results);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseLoadOptions(process.env);
  console.log(`Running read-only simulated load test against ${options.baseUrl} for ${options.durationSeconds}s at concurrency ${options.concurrency}.`);
  const summary = await runLoadTest(options);
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.successes || summary.errorRate > 0.01) process.exitCode = 1;
}
