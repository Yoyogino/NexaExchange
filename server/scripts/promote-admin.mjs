// Promote an existing account to ADMIN by email. There's deliberately no
// self-service "become an admin" flow in the product itself — the only way
// to create an admin is for someone with access to the server/database to
// run this script.
//
// Usage (from the project root, with the API's .env in place):
//   node --env-file=.env server/scripts/promote-admin.mjs someone@example.com
//
// The account must already exist (register it in the app first, then run
// this). Re-running on an already-ADMIN account is a harmless no-op.

import pg from "pg";

const email = process.argv[2];
if (!email) {
  console.error("Usage: node --env-file=.env server/scripts/promote-admin.mjs <email>");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const result = await pool.query(
    "UPDATE users SET role = 'ADMIN' WHERE email = $1 RETURNING id, email, role",
    [email.trim().toLowerCase()],
  );
  if (!result.rows[0]) {
    console.error(`No account found for ${email}. Register the account in the app first, then run this script.`);
    process.exit(1);
  }
  console.log(`Promoted ${result.rows[0].email} to ${result.rows[0].role} (id: ${result.rows[0].id}).`);
} finally {
  await pool.end();
}
