import pg from "pg";
import { placeOrder } from "../../server/matching.mjs";
import { assertIsolatedTestDatabase } from "./test-database.mjs";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await assertIsolatedTestDatabase(pool);
  const request = JSON.parse(process.argv[2]);
  const result = await placeOrder(pool, request);
  process.stdout.write(JSON.stringify(result));
} finally {
  await pool.end();
}
