import assert from "node:assert/strict";
import test from "node:test";
import { runMaintenance } from "../server/maintenance.mjs";

test("maintenance removes expired token state, old sessions, and old order requests", async () => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes("previous_token_expires_at")) return { rowCount: 2 };
      if (sql.includes("DELETE FROM sessions")) return { rowCount: 3 };
      if (sql.includes("DELETE FROM order_requests")) return { rowCount: 4 };
      if (sql.includes("DELETE FROM email_verification_tokens")) return { rowCount: 5 };
      if (sql.includes("DELETE FROM password_reset_tokens")) return { rowCount: 6 };
      throw new Error("Unexpected maintenance query");
    },
  };
  assert.deepEqual(await runMaintenance(pool), { previousTokens: 2, sessions: 3, orderRequests: 4, verificationTokens: 5, passwordResetTokens: 6 });
  assert.equal(queries.length, 5);
});
