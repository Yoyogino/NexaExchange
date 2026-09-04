import pg from "pg";
import { initializeApplicationSchema } from "./initialize-schema.mjs";
import { loadEncryptionKey } from "./secret-encryption.mjs";
import { restrictRuntimePrivileges } from "./runtime-privileges.mjs";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await initializeApplicationSchema(pool, await loadEncryptionKey());
  await restrictRuntimePrivileges(pool);
  console.info(JSON.stringify({ event: "database_migration_complete" }));
} finally {
  await pool.end();
}
