import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(new URL("../scripts/sync-staging-db-role-passwords.mjs", import.meta.url), "utf8");

test("staging role synchronization supports preserved databases with legacy owners", () => {
  assert.match(script, /"exchange_owner", "exchange", "postgres"/);
  assert.match(script, /SELECT current_user/);
  assert.match(script, /"-d", "postgres"/);
  assert.match(script, /probe\.status === 0/);
  assert.match(script, /CREATE ROLE nexa_app LOGIN PASSWORD/);
  assert.match(script, /CREATE ROLE nexa_migrator LOGIN PASSWORD/);
  assert.match(script, /ALTER DATABASE exchange_demo RENAME TO exchange/);
  assert.match(script, /CREATE DATABASE exchange OWNER nexa_migrator/);
  assert.match(script, /ALTER ROLE nexa_app PASSWORD/);
  assert.match(script, /ALTER ROLE nexa_migrator PASSWORD/);
  assert.doesNotMatch(script, /REASSIGN OWNED BY/);
  assert.match(script, /namespace\.nspname = 'public'/);
  assert.match(script, /pg_get_userbyid\(object\.relowner\)/);
  assert.match(script, /ALTER %s %I\.%I OWNER TO nexa_migrator/);
  assert.match(script, /runSql\("postgres", globalSql\)/);
  assert.match(script, /runSql\("exchange", databaseSql\)/);
  assert.doesNotMatch(script, /console\.log\([^\n]*(appPassword|migrationPassword)/);
});
