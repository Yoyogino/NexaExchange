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
if (!owner || !/^[a-z_][a-z0-9_]*$/u.test(owner)) {
  throw new Error("Unable to identify a safe PostgreSQL owner role from the running container.");
}
const sql = [
  `ALTER ROLE nexa_app PASSWORD ${sqlLiteral(appPassword)};`,
  `ALTER ROLE nexa_migrator PASSWORD ${sqlLiteral(migrationPassword)};`,
  "",
].join("\n");

const result = spawnSync(
  "docker",
  ["exec", "-i", "ubuntu-postgres-1", "psql", "-v", "ON_ERROR_STOP=1", "-U", owner, "-d", "exchange"],
  { input: sql, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log("Staging database role passwords synchronized.");
