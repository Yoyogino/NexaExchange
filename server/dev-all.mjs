import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const vite = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const api = spawn(process.execPath, ["--env-file=.env", "server/index.mjs"], { stdio: "inherit" });
let web;

async function waitForApi() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (api.exitCode !== null) throw new Error(`API exited during startup with code ${api.exitCode}.`);
    try {
      const response = await fetch("http://127.0.0.1:3001/api/health", { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch { /* The API is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("API did not become ready within 120 seconds. Confirm Docker Desktop is running, then try again.");
}

try {
  await waitForApi();
  web = spawn(process.execPath, [vite], { stdio: "inherit" });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  api.kill();
  process.exitCode = 1;
}

function stop() {
  api.kill();
  web?.kill();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
api.on("exit", (code) => { if (code && code !== 0) process.exitCode = code; });
web?.on("exit", (code) => { if (code && code !== 0) process.exitCode = code; });
