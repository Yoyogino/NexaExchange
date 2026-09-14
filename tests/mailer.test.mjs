import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createMailer, EmailDeliveryError } from "../server/mailer.mjs";
import { readFile } from "node:fs/promises";

test("production mail failures discard provider messages, names, causes and properties", () => {
  const script = `
    import assert from 'node:assert/strict';
    import { createMailer, EmailDeliveryError } from './server/mailer.mjs';
    const providerError = new Error('PRIVATE_CODE_123456');
    providerError.name = 'PRIVATE_RECIPIENT@example.test';
    providerError.credentials = 'PRIVATE_CREDENTIAL';
    const mailer = createMailer({provider:'generic', apiUrl:'https://mail.example.test', apiKey:'test', from:'test@example.test', fetchImpl:async()=>{throw providerError;}});
    try { await mailer.sendPasswordResetCode('PRIVATE_RECIPIENT@example.test','PRIVATE_CODE_123456'); assert.fail('expected rejection'); }
    catch(error) { assert.ok(error instanceof EmailDeliveryError); assert.equal(error.cause,undefined); assert.equal(error.credentials,undefined); console.error(error); }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    env: { ...process.env, NODE_ENV: "production" }, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /email_delivery_failed/);
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_/);
});

test("reset route hides delivery outages but propagates database and unexpected failures", async () => {
  const source = await readFile(new URL('../server/index.mjs', import.meta.url), 'utf8');
  const route = source.indexOf('app.post("/api/auth/password-reset/request"');
  const start = source.indexOf('async (req, res, next) => {', route) + 'async (req, res, next) => {'.length;
  const end = source.indexOf('\n});', start);
  assert.ok(route >= 0 && end > start);
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  const handler = new AsyncFunction('req','res','next','pool','mailer','V','crypto','issuePasswordResetToken','codeHash','EmailDeliveryError',source.slice(start,end));
  async function exercise({exists=true, failure, databaseFailure=false}={}) {
    let response, forwarded, sends=0;
    const client={query:async()=>{},release(){}};
    const pool={query:async()=>{if(databaseFailure) throw failure; return {rows:exists?[{id:'test-user'}]:[]};},connect:async()=>client};
    await handler({body:{email:'user@example.test'}},{json(value){response=value;}},error=>{forwarded=error;},pool,
      {configured:true,sendPasswordResetCode:async()=>{sends++;if(failure) throw failure;return {delivery:'email'};}},
      {email:v=>v},{randomInt:()=>123456},async()=>{},v=>v,EmailDeliveryError);
    return {response,forwarded,sends};
  }
  const unknown=await exercise({exists:false});
  const outage=await exercise({failure:new EmailDeliveryError()});
  const success=await exercise();
  assert.deepEqual(outage.response,unknown.response);
  assert.deepEqual(success.response,unknown.response);
  assert.equal(outage.forwarded,undefined);
  assert.equal(unknown.sends,0);
  assert.equal(outage.sends,1);
  assert.equal(outage.response.demoCode,undefined);
  const failure=new Error('database or programming failure');
  for(const databaseFailure of [true,false]) {
    const result=await exercise({failure,databaseFailure});
    assert.equal(result.forwarded,failure);
    assert.equal(result.response,undefined);
  }
});

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
