import { cleanupExpiredTokens } from "./session-rotation.mjs";

export async function runMaintenance(pool) {
  const [previousTokens, oldSessions, orderRequests, verificationTokens, passwordResetTokens] = await Promise.all([
    cleanupExpiredTokens(pool),
    pool.query(
      `DELETE FROM sessions
       WHERE expires_at < now() - interval '7 days'
          OR revoked_at < now() - interval '7 days'`,
    ),
    pool.query("DELETE FROM order_requests WHERE created_at < now() - interval '24 hours'"),
    pool.query("DELETE FROM email_verification_tokens WHERE expires_at < now()"),
    pool.query("DELETE FROM password_reset_tokens WHERE expires_at < now()"),
  ]);
  return {
    previousTokens,
    sessions: oldSessions.rowCount,
    orderRequests: orderRequests.rowCount,
    verificationTokens: verificationTokens.rowCount,
    passwordResetTokens: passwordResetTokens.rowCount,
  };
}
