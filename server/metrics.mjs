const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

export function createMetrics() {
  const startedAt = Date.now();
  let requests = 0; let errors = 0; let totalDurationMs = 0; let slowestMs = 0;
  const routes = new Map();
  function record({ method, path, status, durationMs }) {
    requests += 1; totalDurationMs += durationMs; slowestMs = Math.max(slowestMs, durationMs);
    if (status >= 500) errors += 1;
    const key = `${method} ${String(path).replace(UUID, ":id")}`;
    const current = routes.get(key) ?? { requests: 0, errors: 0, totalDurationMs: 0 };
    current.requests += 1; current.totalDurationMs += durationMs; if (status >= 500) current.errors += 1;
    routes.set(key, current);
  }
  function snapshot() {
    return {
      startedAt: new Date(startedAt).toISOString(), uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000), requests, errors,
      totalDurationMs, errorRate: requests ? errors / requests : 0, averageDurationMs: requests ? Math.round(totalDurationMs / requests) : 0, slowestMs,
      routes: [...routes.entries()].map(([route, value]) => ({ route, requests: value.requests, errors: value.errors, averageDurationMs: Math.round(value.totalDurationMs / value.requests) })).sort((a, b) => b.requests - a.requests).slice(0, 10),
    };
  }
  return { record, snapshot };
}
