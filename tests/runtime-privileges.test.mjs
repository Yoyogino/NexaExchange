import assert from "node:assert/strict";
import test from "node:test";
import { assertRestrictedRuntimePrivileges, IMMUTABLE_RUNTIME_TABLES, restrictRuntimePrivileges } from "../server/runtime-privileges.mjs";

test("staging runtime role cannot rewrite permanent financial or audit records", async () => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes("FROM pg_roles")) return { rows: [{ exists: 1 }] };
      return { rows: [] };
    },
  };
  assert.equal(await restrictRuntimePrivileges(pool), true);
  assert.equal(queries.length, 2);
  assert.match(queries[1], /^REVOKE UPDATE, DELETE ON TABLE /);
  assert.match(queries[1], / FROM nexa_app$/);
  for (const table of IMMUTABLE_RUNTIME_TABLES) assert.match(queries[1], new RegExp(`\\b${table}\\b`));
});

test("production startup accepts only the restricted application role", async () => {
  const safePool = { query: async () => ({ rows: [{ role: "nexa_app", canCreateSchemaObjects: false, canRewriteProtectedTables: false }] }) };
  assert.deepEqual(await assertRestrictedRuntimePrivileges(safePool, { NODE_ENV: "production" }), { skipped: false, role: "nexa_app" });
  const developmentPool = { query: async () => assert.fail("development must not inspect staging roles") };
  assert.deepEqual(await assertRestrictedRuntimePrivileges(developmentPool, { NODE_ENV: "development" }), { skipped: true });
});

test("production startup rejects excessive database authority", async () => {
  for (const permissions of [
    { role: "nexa_migrator", canCreateSchemaObjects: true, canRewriteProtectedTables: true },
    { role: "nexa_app", canCreateSchemaObjects: true, canRewriteProtectedTables: false },
    { role: "nexa_app", canCreateSchemaObjects: false, canRewriteProtectedTables: true },
  ]) {
    const pool = { query: async () => ({ rows: [permissions] }) };
    await assert.rejects(() => assertRestrictedRuntimePrivileges(pool, { NODE_ENV: "production" }));
  }
});
