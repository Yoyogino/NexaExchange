import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";

const baseUrl = new URL(process.argv[2] || process.env.STAGING_URL);
if (baseUrl.protocol !== "https:") throw new Error("STAGING_URL must use HTTPS.");

function cookies(response) {
  const values = response.headers.getSetCookie?.() ?? [];
  return Object.fromEntries(values.map((value) => {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    return [pair.slice(0, separator), pair.slice(separator + 1)];
  }));
}

function cookieHeader(values) {
  return Object.entries(values).map(([name, value]) => `${name}=${value}`).join("; ");
}

const email = `rotation-smoke-${Date.now()}-${crypto.randomBytes(4).toString("hex")}@example.test`;
const password = `${crypto.randomBytes(24).toString("base64url")}Aa1!`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const register = await fetch(new URL("/api/auth/register", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(register.status, 201, `Registration failed with ${register.status}.`);
  const original = cookies(register);
  assert.ok(original.nexa_session && original.nexa_csrf, "Registration cookies were missing.");

  await pool.query(
    `UPDATE sessions
        SET last_seen_at = now() - interval '6 minutes',
            rotated_at = now() - interval '6 minutes'
      WHERE user_id = (SELECT id FROM users WHERE email = $1)
        AND revoked_at IS NULL`,
    [email],
  );

  const rotate = await fetch(new URL("/api/me", baseUrl), {
    headers: { cookie: cookieHeader(original) },
  });
  assert.equal(rotate.status, 200, `Rotation request failed with ${rotate.status}.`);
  const rotatedSet = cookies(rotate);
  const rotated = { ...original, ...rotatedSet };
  assert.ok(rotatedSet.nexa_session, "Rotation did not issue a new session cookie.");
  assert.notEqual(rotated.nexa_session, original.nexa_session, "Session token did not change.");

  const grace = await fetch(new URL("/api/me", baseUrl), {
    headers: { cookie: cookieHeader(original) },
  });
  assert.equal(grace.status, 200, "The previous token was not accepted during its grace period.");

  await pool.query(
    `UPDATE sessions
        SET previous_token_expires_at = now() - interval '1 second'
      WHERE user_id = (SELECT id FROM users WHERE email = $1)
        AND revoked_at IS NULL`,
    [email],
  );

  const expired = await fetch(new URL("/api/me", baseUrl), {
    headers: { cookie: cookieHeader(original) },
  });
  assert.equal(expired.status, 401, "The expired previous token was still accepted.");

  const current = await fetch(new URL("/api/me", baseUrl), {
    headers: { cookie: cookieHeader(rotated) },
  });
  assert.equal(current.status, 200, "The rotated token was not accepted.");

  const logout = await fetch(new URL("/api/auth/logout", baseUrl), {
    method: "POST",
    headers: {
      cookie: cookieHeader(rotated),
      "x-csrf-token": rotated.nexa_csrf,
    },
  });
  assert.equal(logout.status, 204, `Logout failed with ${logout.status}.`);

  const revoked = await fetch(new URL("/api/me", baseUrl), {
    headers: { cookie: cookieHeader(rotated) },
  });
  assert.equal(revoked.status, 401, "The logged-out token was still accepted.");

  console.log(JSON.stringify({
    rotationIssuedNewToken: true,
    previousTokenAcceptedDuringGrace: true,
    previousTokenRejectedAfterExpiry: true,
    rotatedTokenAccepted: true,
    logoutRevokedRotatedToken: true,
  }));
} finally {
  await pool.end();
}
