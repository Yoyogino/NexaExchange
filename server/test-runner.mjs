import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import pg from "pg";

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL is required to run integration tests.");

const schema = `nexa_test_${process.pid}`;
if (!/^nexa_test_\d+$/.test(schema)) throw new Error("Unsafe test schema name.");

const admin = new pg.Pool({ connectionString: baseUrl });
const testUrl = new URL(baseUrl);
testUrl.searchParams.set("options", `-csearch_path=${schema}`);

try {
  await admin.query(`CREATE SCHEMA ${schema}`);

  const testFiles = readdirSync("tests")
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => `tests/${name}`);

  const child = spawn(
    process.execPath,
    ["--test", "--test-concurrency=1", ...testFiles],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: testUrl.toString(), NEXA_TEST_SCHEMA: schema },
      stdio: "inherit",
      shell: false,
    },
  );

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) process.exitCode = exitCode;
} finally {
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}
