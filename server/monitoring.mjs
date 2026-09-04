import crypto from "node:crypto";

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ""));
  const b = Buffer.from(String(right ?? ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function assertMonitoringConfiguration(env = process.env) {
  if (env.NODE_ENV === "production" && !env.MONITORING_TOKEN) {
    throw new Error("Production requires MONITORING_TOKEN.");
  }
}

export function createMonitoringHandler({ metrics, pool, redis, token = process.env.MONITORING_TOKEN } = {}) {
  return async (req, res, next) => {
    const supplied = req.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token || !safeEqual(supplied, token)) return res.status(404).end();
    try {
      const [database, cache] = await Promise.allSettled([pool.query("SELECT 1"), redis.ping()]);
      const snapshot = metrics.snapshot();
      const lines = [
        "# HELP nexa_up Whether the API process is serving metrics.",
        "# TYPE nexa_up gauge",
        "nexa_up 1",
        "# HELP nexa_dependency_up Whether a required dependency is reachable.",
        "# TYPE nexa_dependency_up gauge",
        `nexa_dependency_up{dependency="postgres"} ${database.status === "fulfilled" ? 1 : 0}`,
        `nexa_dependency_up{dependency="redis"} ${cache.status === "fulfilled" ? 1 : 0}`,
        "# TYPE nexa_http_requests_total counter",
        `nexa_http_requests_total ${snapshot.requests}`,
        "# TYPE nexa_http_errors_total counter",
        `nexa_http_errors_total ${snapshot.errors}`,
        "# TYPE nexa_http_request_duration_milliseconds_total counter",
        `nexa_http_request_duration_milliseconds_total ${snapshot.totalDurationMs}`,
        "# TYPE nexa_process_uptime_seconds gauge",
        `nexa_process_uptime_seconds ${snapshot.uptimeSeconds}`,
        "# TYPE nexa_process_resident_memory_bytes gauge",
        `nexa_process_resident_memory_bytes ${process.memoryUsage().rss}`,
      ];
      res.type("text/plain; version=0.0.4").send(lines.join("\n") + "\n");
    } catch (error) { next(error); }
  };
}
