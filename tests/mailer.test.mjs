import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createMailer } from "../server/mailer.mjs";

test("local mail delivery does not call the network", async () => {
  let called = false;
  const mailer = createMailer({ fetchImpl: async () => { called = true; throw new Error("unexpected"); } });
  assert.deepEqual(await mailer.sendVerificationCode("user@example.test", "123456"), { delivery: "local-demo" });
  assert.equal(called, false);
});

test("configured mail delivery sends a provider request without exposing the code in its result", async () => {
  let request;
  const mailer = createMailer({
    apiUrl: "https://mail.example.test/send",
    apiKey: "secret-key",
    from: "Nexa <security@example.test>",
    fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, status: 202 }; },
  });
  assert.deepEqual(await mailer.sendPasswordResetCode("user@example.test", "654321"), { delivery: "email" });
  assert.equal(request.url, "https://mail.example.test/send");
  assert.equal(request.options.headers.authorization, "Bearer secret-key");
  const payload = JSON.parse(request.options.body);
  assert.deepEqual(payload.to, ["user@example.test"]);
  assert.match(payload.text, /654321/);
});

test("email failures do not log recipient addresses or expose provider errors", async () => {
  const messages = [];
  const originalError = console.error;
  console.error = (message) => messages.push(String(message));
  try {
    const mailer = createMailer({
      apiUrl: "https://mail.example.test/send",
      apiKey: "secret-key",
      from: "Nexa <security@example.test>",
      fetchImpl: async () => ({ ok: false, status: 500, text: async () => "secret provider diagnostic" }),
    });
    assert.deepEqual(await mailer.sendVerificationCode("private-user@example.test", "123456"), { delivery: "local-demo" });
  } finally { console.error = originalError; }
  assert.equal(messages.length, 1);
  assert.doesNotMatch(messages[0], /private-user|123456|secret provider diagnostic/);
  assert.match(messages[0], /recipientHash/);
});

test("production refuses to start with the generic mock email provider", () => {
  const script = 'import { createMailer } from "./server/mailer.mjs"; createMailer({ provider: "generic", from: "security@nexa.test" });';
  const environment = { ...process.env, NODE_ENV: "production" };
  delete environment.EMAIL_API_URL;
  delete environment.EMAIL_API_KEY;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], { cwd: process.cwd(), env: environment, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Production email delivery requires configuration/);
});
