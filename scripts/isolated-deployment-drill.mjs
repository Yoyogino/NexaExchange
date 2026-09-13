import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

// This intentionally uses the workflow's ubuntu names, on an empty hosted runner only.
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
assert.equal(process.platform, "linux");
assert.ok(process.env.RUNNER_TEMP);
const root = process.cwd();
const directory = join(resolve(process.env.RUNNER_TEMP), "nexa-deployment-drill");
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 600000, ...options });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
assert.equal(run("docker", ["ps", "-aq"]), "", "Runner must have no existing containers");
assert.equal(run("docker", ["volume", "ls", "-q"]), "", "Runner must have no existing volumes");
await mkdir(directory, { recursive: false, mode: 0o700 });
await mkdir(join(directory, "scripts"));
await copyFile(join(root, "scripts/sync-staging-db-role-passwords.mjs"), join(directory, "scripts/sync-staging-db-role-passwords.mjs"));
const workflow = await readFile(join(root, ".github/workflows/deploy-staging.yml"), "utf8");
const start = workflow.indexOf("          set -eu", workflow.indexOf("      - name: Deploy and verify readiness"));
const end = workflow.indexOf("      - name:", start);
assert.ok(start >= 0 && end > start);
const deployment = workflow.slice(start, end).replace(/^          /gm, "");
await writeFile(join(directory, "deployment.sh"), deployment);
const appPassword = randomBytes(24).toString("hex");
const migrationPassword = randomBytes(24).toString("hex");
const key = randomBytes(32).toString("base64");
await writeFile(join(directory, ".env.staging"), `POSTGRES_APP_PASSWORD=${appPassword}\nPOSTGRES_MIGRATION_PASSWORD=${migrationPassword}\n`, { mode: 0o600 });
await writeFile(join(directory, ".env.compose"), "", { mode: 0o600 });
const configuration = {
  services: {
    postgres: {
      image: "postgres:17-alpine",
      environment: { POSTGRES_DB: "exchange", POSTGRES_USER: "exchange_owner", POSTGRES_PASSWORD: randomBytes(24).toString("hex"), POSTGRES_APP_PASSWORD: appPassword, POSTGRES_MIGRATION_PASSWORD: migrationPassword },
      volumes: ["database:/var/lib/postgresql/data", `${join(root, "deploy/postgres/01-app-role.sh")}:/docker-entrypoint-initdb.d/01-app-role.sh:ro`],
      healthcheck: { test: ["CMD-SHELL", "pg_isready -U exchange_owner -d exchange"], interval: "2s", timeout: "3s", retries: 30 },
    },
    redis: { image: "redis:7-alpine", healthcheck: { test: ["CMD", "redis-cli", "ping"], interval: "2s", timeout: "3s", retries: 30 } },
    app: {
      build: { context: directory, dockerfile: "Dockerfile.app" },
      environment: { NODE_ENV: "production", RUN_MIGRATIONS: "0", PORT: "3001", TRUST_PROXY: "1", DATABASE_URL: `postgresql://nexa_app:${appPassword}@postgres:5432/exchange`, REDIS_URL: "redis://redis:6379", DATA_ENCRYPTION_KEY: key, EMAIL_PROVIDER: "generic", EMAIL_API_URL: "http://127.0.0.1:9", EMAIL_API_KEY: "isolated-test", EMAIL_FROM: "drill@example.test", MONITORING_TOKEN: randomBytes(24).toString("hex") },
    },
    migrate: {
      build: { context: directory, dockerfile: "Dockerfile.migrate" },
      command: ["node", "server/migrate.mjs"],
      environment: { NODE_ENV: "production", DATABASE_URL: `postgresql://nexa_migrator:${migrationPassword}@postgres:5432/exchange`, DATA_ENCRYPTION_KEY: key },
    },
    proxy: { image: "redis:7-alpine" }, // Stand-in: no DNS, TLS, or published ports in this drill.
  },
  networks: { default: { internal: true } },
  volumes: { database: { external: true, name: "${POSTGRES_VOLUME_NAME:-ubuntu_staging_postgres}" } },
};
async function saveConfiguration() {
  await writeFile(join(directory, "compose.staging.yml"), JSON.stringify(configuration), { mode: 0o600 });
}
await saveConfiguration();
await writeFile(join(directory, "Dockerfile.app"), "FROM nexa-drill-base:local\n");
await writeFile(join(directory, "Dockerfile.migrate"), "FROM nexa-drill-base:local\n");
run("docker", ["build", "-t", "nexa-drill-base:local", root]);
for (const image of ["postgres:17-alpine", "redis:7-alpine"]) run("docker", ["pull", image]);
function execute() {
  return spawnSync("bash", ["--noprofile", "--norc", "deployment.sh"], { cwd: directory, encoding: "utf8", timeout: 600000 });
}
function inspect(name, format) { return run("docker", ["inspect", "--format", format, name]); }
function sql(query) { return run("docker", ["exec", "ubuntu-postgres-1", "psql", "-U", "exchange_owner", "-d", "exchange", "-Atqc", query]); }
function snapshot() {
  return {
    postgres: inspect("ubuntu-postgres-1", "{{.Id}}"),
    redis: inspect("ubuntu-redis-1", "{{.Id}}"),
    network: run("docker", ["network", "inspect", "ubuntu_default", "--format", "{{.Id}}"]),
    volume: inspect("ubuntu-postgres-1", '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}'),
    ledger: sql("SELECT count(*) || ':' || md5(string_agg(row_to_json(e)::text, '' ORDER BY id)) FROM ledger_entries e"),
  };
}
function ready() {
  run("docker", ["exec", "ubuntu-app-1", "wget", "--timeout=5", "--header=X-Forwarded-Proto: https", "--no-verbose", "--spider", "http://127.0.0.1:3001/api/ready"]);
}
const baseline = execute();
assert.ifError(baseline.error);
assert.equal(baseline.status, 0, baseline.stderr + baseline.stdout);
ready();
run("docker", ["exec", "-i", "ubuntu-app-1", "node", "--input-type=module"], { input: `
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { fundDemoBalance } from './server/ledger.mjs';
const c = new pg.Client({connectionString:process.env.DATABASE_URL});
await c.connect();
try {
  await c.query('BEGIN');
  const id=randomUUID();
  await c.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[id,'drill@example.test','not-a-login-hash']);
  await fundDemoBalance(c,{userId:id,asset:'BTC',amount:'1',reason:'isolated workflow drill'});
  await c.query('COMMIT');
} finally {await c.end();}
` });
const original = snapshot();
assert.ok(original.ledger.startsWith("2:"), "Require nonempty balanced seed records");
const appId = inspect("ubuntu-app-1", "{{.Id}}");
const appImage = inspect("ubuntu-app-1", "{{.Image}}");
configuration.services.migrate.environment.DATABASE_URL += "?options=-cdefault_transaction_read_only%3Don";
await saveConfiguration();
const migration = execute();
assert.ifError(migration.error);
assert.equal(migration.status, 1);
assert.match(migration.stderr + migration.stdout, /read.only transaction/i);
assert.equal(inspect("ubuntu-app-1", "{{.Id}}"), appId);
assert.deepEqual(snapshot(), original);
ready();
configuration.services.migrate.environment.DATABASE_URL = configuration.services.migrate.environment.DATABASE_URL.split("?")[0];
await saveConfiguration();
await writeFile(join(directory, "Dockerfile.app"), 'FROM nexa-drill-base:local\nCMD ["node","-e","require(\'http\').createServer((q,s)=>{s.writeHead(503);s.end(\'injected failure\')}).listen(3001,\'0.0.0.0\')"]\n');
const rollback = execute();
assert.ifError(rollback.error);
assert.equal(rollback.status, 1);
assert.match(rollback.stdout, /Application recovery readiness confirmed; deployment remains failed/);
assert.notEqual(inspect("ubuntu-app-1", "{{.Id}}"), appId);
assert.equal(inspect("ubuntu-app-1", "{{.Image}}"), appImage);
assert.deepEqual(snapshot(), original);
ready();
assert.equal(sql("SELECT count(*) FROM (SELECT group_id FROM ledger_entries GROUP BY group_id HAVING sum(CASE WHEN direction='CREDIT' THEN amount ELSE -amount END)<>0) bad"), "0");
const result = { baselineReady: true, migrationFailurePreservedApp: true, previousImageRecovered: true, ledgerPreserved: true, dependenciesNetworkVolumePreserved: true, recoveredReady: true };
await writeFile(join(root, "drill-result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
// Hosted runner disposal removes all test resources. Never export configuration or raw logs.
