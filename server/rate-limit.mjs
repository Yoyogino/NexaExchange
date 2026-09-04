import crypto from "node:crypto";

const SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return count
`;

export function createRateLimit(redis) {
  return function rateLimit({ windowMs, limit, scope = "api", identity: identify = (req) => req.ip ?? "unknown" }) {
    return async (req, res, next) => {
      const identity = crypto.createHash("sha256").update(String(identify(req))).digest("hex").slice(0, 24);
      const key = `nexa:rate:${scope}:${identity}`;
      try {
        const count = Number(await redis.eval(SCRIPT, { keys: [key], arguments: [String(windowMs)] }));
        res.setHeader("RateLimit-Limit", String(limit));
        res.setHeader("RateLimit-Remaining", String(Math.max(0, limit - count)));
        if (count > limit) {
          res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
          return res.status(429).json({ error: "Too many requests. Please try again shortly." });
        }
        next();
      } catch (error) {
        console.error(JSON.stringify({ event: "rate_limit_unavailable", message: error instanceof Error ? error.message : String(error) }));
        res.status(503).json({ error: "Security service is temporarily unavailable. Please try again shortly." });
      }
    };
  };
}
