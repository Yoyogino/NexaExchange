import { spawnSync } from "node:child_process";

function requiredPassword(name) {
  const value = process.env[name];
  if (!value || value.includes("\0")) throw new Error(`${name} is required and must not contain a null byte.`);
  return value;
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

const appPassword = requiredPassword("POSTGRES_APP_PASSWORD");
const migrationPassword = requiredPassword("POSTGRES_MIGRATION_PASSWORD");
const inspect = spawnSync(
  "docker",
  ["inspect", "--format", "{{range .Config.Env}}{{println .}}{{end}}", "ubuntu-postgres-1"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
);
if (inspect.error) throw inspect.error;
if (inspect.status !== 0) process.exit(inspect.status ?? 1);
const owner = inspect.stdout
  .split(/\r?\n/u)
  .find((entry) => entry.startsWith("POSTGRES_USER="))
  ?.slice("POSTGRES_USER=".length);
const ownerCandidates = [...new Set([owner, "exchange_owner", "exchange", "postgres"])]
  .filter((candidate) => candidate && /^[a-z_][a-z0-9_]*$/u.test(candidate));
const activeOwner = ownerCandidates.find((candidate) => {
  const probe = spawnSync(
    "docker",
    ["exec", "ubuntu-postgres-1", "psql", "-v", "ON_ERROR_STOP=1", "-U", candidate, "-d", "postgres", "-Atqc", "SELECT current_user"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return !probe.error && probe.status === 0 && probe.stdout.trim() === candidate;
});
if (!activeOwner) throw new Error("Unable to connect using a known PostgreSQL owner role.");
const sql = [
  `SELECT format('CREATE ROLE nexa_app LOGIN PASSWORD %L', ${sqlLiteral(appPassword)})`,
  "WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexa_app') \\gexec",
  `SELECT format('CREATE ROLE nexa_migrator LOGIN PASSWORD %L', ${sqlLiteral(migrationPassword)})`,
  "WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexa_migrator') \\gexec",
  `ALTER ROLE nexa_app PASSWORD ${sqlLiteral(appPassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;`,
  `ALTER ROLE nexa_migrator PASSWORD ${sqlLiteral(migrationPassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;`,
  "GRANT CONNECT ON DATABASE exchange TO nexa_app;",
  "GRANT CONNECT ON DATABASE exchange TO nexa_migrator;",
  ...(activeOwner === "postgres" ? [] : [`REASSIGN OWNED BY ${activeOwner} TO nexa_migrator;`]),
  "REVOKE CREATE ON SCHEMA public FROM PUBLIC;",
  "GRANT USAGE ON SCHEMA public TO nexa_app;",
  "GRANT USAGE, CREATE ON SCHEMA public TO nexa_migrator;",
  "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nexa_app;",
  "GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO nexa_app;",
  "ALTER DEFAULT PRIVILEGES FOR ROLE nexa_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nexa_app;",
  "ALTER DEFAULT PRIVILEGES FOR ROLE nexa_migrator IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO nexa_app;",
  "",
].join("\n");

const result = spawnSync(
  "docker",
  ["exec", "-i", "ubuntu-postgres-1", "psql", "-v", "ON_ERROR_STOP=1", "-U", activeOwner, "-d", "exchange"],
  { input: sql, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log("Staging database role passwords synchronized.");
