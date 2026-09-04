/**
 * Integration layer for session token rotation with existing session system.
 * 
 * This module provides drop-in replacements for session functions that integrate
 * token rotation into the existing API middleware.
 */

import { 
  authenticateSessionToken, 
  touchSessionWithRotation,
} from "./session-rotation.mjs";
import { runMaintenance } from "./maintenance.mjs";

const ROTATION_INTERVAL_MINUTES = 5;
const ENABLE_ROTATION = true;

/**
 * Enhanced session authentication with token rotation support.
 * Validates tokens and handles rotation.
 * 
 * Returns:
 * - { authenticated: true, sessionId, userId, newToken?, error: null }
 * - { authenticated: false, error: string }
 */
export async function authenticateAndRotateSession(
  pool,
  token,
  idleMinutes = 30,
) {
  if (!token) {
    return { authenticated: false, error: "No session token provided" };
  }

  try {
    // Authenticate token (handles both current and previous tokens)
    const auth = await authenticateSessionToken(pool, token, idleMinutes);
    
    if (!auth) {
      return { authenticated: false, error: "Invalid or expired session token" };
    }

    // Touch session and attempt rotation
    const rotation = await touchSessionWithRotation(
      pool,
      auth.sessionId,
      ROTATION_INTERVAL_MINUTES,
      ENABLE_ROTATION,
    );

    return {
      authenticated: true,
      sessionId: auth.sessionId,
      userId: auth.userId,
      newToken: rotation.newToken,
      rotated: rotation.rotated,
      error: null,
    };
  } catch (error) {
    console.error(JSON.stringify({ event: "session_auth_error", error: error.message }));
    return { authenticated: false, error: "Session authentication failed" };
  }
}

/**
 * Middleware wrapper for express.js requireSession.
 * Integrates token rotation into existing auth flow.
 */
export function createSessionMiddleware(pool, cookieName, cookiesFor, cookieOptions) {
  return async (req, res, next) => {
    const token = cookiesFor(req)[cookieName] ?? null;
    
    if (!token) {
      return res.status(401).json({ error: "Please sign in." });
    }

    try {
      const auth = await authenticateAndRotateSession(pool, token);
      
      if (!auth.authenticated) {
        return res.status(401).json({ error: auth.error ?? "Please sign in." });
      }

      // Attach to request
      req.userId = auth.userId;
      req.sessionId = auth.sessionId;

      // Keep the credential inaccessible to JavaScript. Express emits a new
      // HttpOnly Set-Cookie header when the server rotates the session.
      if (auth.newToken) {
        res.cookie(cookieName, auth.newToken, cookieOptions);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Middleware to handle cleanup of expired tokens.
 * Should be called periodically (e.g., every minute).
 */
export function createCleanupMiddleware(pool) {
  let lastCleanup = Date.now();
  const CLEANUP_INTERVAL_MS = 60_000; // 1 minute

  return async (req, res, next) => {
    const now = Date.now();
    if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
      // Claim this cleanup window before awaiting so concurrent requests do
      // not start duplicate maintenance jobs.
      lastCleanup = now;
      try {
        const cleaned = await runMaintenance(pool);
        if (cleaned.previousTokens || cleaned.sessions || cleaned.orderRequests) {
          console.info(JSON.stringify({ event: "maintenance_cleanup", ...cleaned }));
        }
      } catch (error) {
        console.error(JSON.stringify({ event: "maintenance_cleanup_error", error: error.message }));
        // Don't fail the request if cleanup fails
      }
    }
    next();
  };
}

/**
 * Extract a browser session token from its HttpOnly cookie. Authorization
 * headers are intentionally ignored so session credentials have one transport.
 */
export function extractSessionToken(req, cookieName) {
  const cookieToken = extractCookies(req)[cookieName];
  if (cookieToken) return cookieToken;
  return null;
}

/**
 * Parse cookies from request headers.
 */
function extractCookies(req) {
  const result = {};
  if (!req.headers.cookie) return result;
  for (const part of req.headers.cookie.split(/;\s*/)) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    try {
      result[decodeURIComponent(part.slice(0, separator).trim())] = decodeURIComponent(
        part.slice(separator + 1),
      );
    } catch {
      // Ignore malformed cookies
    }
  }
  return result;
}

/**
 * Periodic task to collect and log rotation statistics.
 * Useful for monitoring and debugging.
 */
export async function logRotationStats(pool) {
  try {
    const result = await pool.query(
      `SELECT 
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE previous_token_hash IS NOT NULL) as in_grace_period,
         COUNT(*) FILTER (WHERE rotated_at > now() - interval '1 hour') as rotated_last_hour,
         EXTRACT(EPOCH FROM (now() - MIN(rotated_at))) / 3600 as hours_since_oldest_rotation
       FROM sessions 
       WHERE revoked_at IS NULL AND expires_at > now()`,
    );

    if (result.rows[0]) {
      console.info(JSON.stringify({ event: "session_rotation_stats", ...result.rows[0] }));
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "rotation_stats_error", error: error.message }));
  }
}

/**
 * Health check for session rotation system.
 * Returns status and metrics.
 */
export async function getSessionRotationHealth(pool) {
  try {
    const result = await pool.query(
      `SELECT 
         COUNT(*) as total_sessions,
         COUNT(*) FILTER (WHERE previous_token_hash IS NOT NULL) as sessions_in_grace_period,
         ROUND(100.0 * COUNT(*) FILTER (WHERE previous_token_hash IS NOT NULL) / NULLIF(COUNT(*), 0), 2) as grace_period_percentage,
         COUNT(*) FILTER (WHERE rotated_at > now() - interval '5 minutes') as rotated_in_last_5min
       FROM sessions 
       WHERE revoked_at IS NULL AND expires_at > now()`,
    );

    const stats = result.rows[0];
    const healthy = stats.grace_period_percentage < 10; // Alert if > 10% in grace period

    return {
      healthy,
      timestamp: new Date().toISOString(),
      totalSessions: parseInt(stats.total_sessions),
      sessionsInGracePeriod: parseInt(stats.sessions_in_grace_period),
      gracePeriodPercentage: parseFloat(stats.grace_period_percentage),
      rotatedIn5min: parseInt(stats.rotated_in_last_5min),
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}
