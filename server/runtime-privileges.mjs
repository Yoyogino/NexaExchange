export const IMMUTABLE_RUNTIME_TABLES = ["ledger_entries", "ledger_accounts", "audit_events", "trades"];

export async function restrictRuntimePrivileges(pool) {
  const role = await pool.query("SELECT 1 FROM pg_roles WHERE rolname='nexa_app'");
  if (!role.rows[0]) return false;
  await pool.query(`REVOKE UPDATE, DELETE ON TABLE ${IMMUTABLE_RUNTIME_TABLES.join(", ")} FROM nexa_app`);
  return true;
}

export async function assertRestrictedRuntimePrivileges(pool, env = process.env) {
  if (env.NODE_ENV !== "production") return { skipped: true };
  const result = await pool.query(
    `SELECT current_user AS role,
            has_schema_privilege(current_user, current_schema(), 'CREATE') AS "canCreateSchemaObjects",
            EXISTS (
              SELECT 1 FROM unnest($1::text[]) AS protected(table_name)
              WHERE has_table_privilege(current_user, protected.table_name, 'UPDATE')
                 OR has_table_privilege(current_user, protected.table_name, 'DELETE')
            ) AS "canRewriteProtectedTables"`,
    [IMMUTABLE_RUNTIME_TABLES],
  );
  const permissions = result.rows[0];
  if (permissions?.role !== "nexa_app") throw new Error("Production API must connect to PostgreSQL as the restricted nexa_app role.");
  if (permissions.canCreateSchemaObjects) throw new Error("Production API database role must not create schema objects.");
  if (permissions.canRewriteProtectedTables) throw new Error("Production API database role can rewrite protected financial or audit records.");
  return { skipped: false, role: permissions.role };
}
