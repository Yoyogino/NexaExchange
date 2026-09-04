/** Refuse destructive integration-test setup outside the runner's isolated schema. */
export async function assertIsolatedTestDatabase(pool, env = process.env) {
  const expected = env.NEXA_TEST_SCHEMA;
  if (!expected || !/^nexa_test_\d+$/.test(expected)) {
    throw new Error("Database tests must be run through server/test-runner.mjs; refusing to modify a non-test database.");
  }
  const result = await pool.query("SELECT current_schema() AS schema");
  if (result.rows[0]?.schema !== expected) {
    throw new Error(`Database test schema mismatch; expected ${expected}. Refusing destructive setup.`);
  }
}
