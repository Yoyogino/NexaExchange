import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const compose = await readFile(new URL("../compose.staging.yml", import.meta.url), "utf8");
const roleSetup = await readFile(new URL("../deploy/postgres/01-app-role.sh", import.meta.url), "utf8");
const migration = await readFile(new URL("../server/migrate.mjs", import.meta.url), "utf8");

test("staging uses a restricted application database role", () => {
  assert.match(compose, /DATABASE_URL: postgresql:\/\/nexa_app:/);
  assert.match(compose, /DATABASE_URL: postgresql:\/\/nexa_migrator:/);
  assert.match(compose, /RUN_MIGRATIONS: 0/);
  assert.match(compose, /condition: service_completed_successfully/);
  assert.match(compose, /POSTGRES_USER: exchange_owner/);
  assert.match(compose, /01-app-role\.sh/);
  assert.match(roleSetup, /NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION/);
  assert.match(roleSetup, /GRANT USAGE ON SCHEMA public TO nexa_app/);
  assert.doesNotMatch(roleSetup, /GRANT USAGE, CREATE ON SCHEMA public TO nexa_app/);
  assert.doesNotMatch(roleSetup, /GRANT ALL|\bSUPERUSER\b/);
  assert.match(migration, /restrictRuntimePrivileges\(pool\)/);
});
