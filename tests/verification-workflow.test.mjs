import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../.github/workflows/verify.yml", import.meta.url), "utf8");

test("verification creates the test environment before running the suite", () => {
  const environmentStep = workflow.indexOf("cp .env.example .env");
  const testStep = workflow.indexOf("run: npm run test");

  assert.notEqual(environmentStep, -1);
  assert.notEqual(testStep, -1);
  assert.ok(environmentStep < testStep);
  assert.doesNotMatch(workflow, /SMTP_PASSWORD=|MONITORING_TOKEN=/);
});
