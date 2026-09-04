const PRODUCTION = "production";

export function assertProxyConfiguration(env = process.env) {
  if (env.NODE_ENV === PRODUCTION && env.TRUST_PROXY !== "1") {
    throw new Error("Production requires TRUST_PROXY=1 behind a TLS-terminating reverse proxy.");
  }
}

export function securityHeaders({ production = process.env.NODE_ENV === PRODUCTION } = {}) {
  return (req, res, next) => {
    const connectSources = production ? "'self'" : "'self' ws: wss:";
    res.setHeader("Content-Security-Policy", `default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src ${connectSources}`);
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=()");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    if (production) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  };
}

export function requireHttps({ production = process.env.NODE_ENV === PRODUCTION } = {}) {
  return (req, res, next) => {
    if (production && !req.secure) return res.status(400).json({ error: "HTTPS is required." });
    next();
  };
}

/** API responses can contain credentials, balances, or operator data and must never be cached. */
export function apiNoStore() {
  return (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
  };
}
