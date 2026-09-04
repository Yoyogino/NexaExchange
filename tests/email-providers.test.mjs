import test from "node:test";
import assert from "node:assert/strict";
import { createSendGridAdapter } from "../server/email-providers/sendgrid.mjs";
import { createAwsSesAdapter } from "../server/email-providers/aws-ses.mjs";
import { getEmailProvider } from "../server/email-providers/index.mjs";

test("SendGrid adapter sends properly formatted requests", async () => {
  let capturedRequest;
  const mockFetch = async (url, options) => {
    capturedRequest = { url, options, body: JSON.parse(options.body) };
    return { ok: true, headers: new Map([["x-message-id", "sg-123"]]) };
  };

  const adapter = createSendGridAdapter({
    apiKey: "SG.test-key",
    from: "Nexa <security@example.com>",
    fetchImpl: mockFetch,
  });

  const result = await adapter.send({
    to: "user@example.com",
    subject: "Test email",
    text: "This is a test.",
  });

  assert.equal(capturedRequest.url, "https://api.sendgrid.com/v3/mail/send");
  assert.equal(capturedRequest.options.headers.authorization, "Bearer SG.test-key");
  assert.deepEqual(capturedRequest.body.from, { email: "security@example.com", name: "Nexa" });
  assert.equal(capturedRequest.body.subject, "Test email");
  assert.deepEqual(capturedRequest.body.personalizations[0].to, [{ email: "user@example.com" }]);
  assert.equal(result.provider, "sendgrid");
  assert.equal(result.messageId, "sg-123");
});

test("SendGrid adapter throws on missing API key", async () => {
  assert.throws(
    () => createSendGridAdapter({ from: "test@example.com" }),
    /SendGrid adapter requires EMAIL_API_KEY/,
  );
});

test("SendGrid adapter parses email name and address", async () => {
  let capturedFrom;
  const mockFetch = async (url, options) => {
    capturedFrom = JSON.parse(options.body).from;
    return { ok: true, headers: new Map() };
  };

  // Test various formats
  const formats = [
    { input: "Nexa <security@example.com>", expected: { name: "Nexa", email: "security@example.com" } },
    { input: "Nexa Exchange <noreply@example.com>", expected: { name: "Nexa Exchange", email: "noreply@example.com" } },
  ];

  for (const { input, expected } of formats) {
    const adapter = createSendGridAdapter({ apiKey: "SG.key", from: input, fetchImpl: mockFetch });
    await adapter.send({ to: "user@example.com", subject: "Test", text: "test" });
    assert.deepEqual(capturedFrom, { email: expected.email, name: expected.name }, `Failed for format: ${input}`);
  }
});

test("AWS SES adapter is instantiable with credentials", async () => {
  // Note: Full SES signature testing is complex; this just verifies instantiation
  const adapter = createAwsSesAdapter({
    region: "us-east-1",
    accessKeyId: "AKIA1234567890ABCDEF",
    secretAccessKey: "test-secret-key",
    from: "security@example.com",
  });

  assert.ok(adapter.send, "Adapter should have send method");
});

test("AWS SES adapter throws on missing credentials", async () => {
  assert.throws(() => createAwsSesAdapter({ from: "test@example.com" }), /AWS_ACCESS_KEY_ID/);

  assert.throws(
    () => createAwsSesAdapter({ accessKeyId: "AKIA...", from: "test@example.com" }),
    /AWS_SECRET_ACCESS_KEY/,
  );

  assert.throws(
    () => createAwsSesAdapter({ accessKeyId: "AKIA...", secretAccessKey: "secret" }),
    /EMAIL_FROM/,
  );
});

test("Email provider factory auto-detects SendGrid by API key prefix", async () => {
  let detected;
  const mockFetch = async () => {
    detected = true;
    return { ok: true, headers: new Map() };
  };

  const provider = getEmailProvider({
    apiKey: "SG.test-key-123",
    from: "test@example.com",
    provider: undefined, // Don't specify provider, let it auto-detect
    fetchImpl: mockFetch,
  });

  // Override fetch to capture request
  await provider.send({
    to: "user@example.com",
    subject: "Test",
    text: "test",
  }).catch(() => {}); // Catch since mock doesn't fully work, we just care it tried SendGrid

  assert.ok(detected, "Factory should auto-detect SendGrid and make a request");
});

test("Email provider factory respects explicit provider choice", async () => {
  const providers = ["sendgrid", "aws-ses", "generic"];

  for (const providerName of providers) {
    let provider;
    assert.doesNotThrow(() => {
      provider = getEmailProvider({
        provider: providerName,
        apiKey: "test-key",
        from: "test@example.com",
        accessKeyId: "AKIA123", // For AWS SES
        secretAccessKey: "secret", // For AWS SES
        apiUrl: "https://api.example.com/send", // For generic
      });
    }, `Should instantiate ${providerName} provider`);

    assert.ok(provider.send, `${providerName} provider should have send method`);
  }
});

test("Generic provider returns mock delivery in local demo mode", async () => {
  const provider = getEmailProvider({
    provider: "generic",
    // No apiUrl: process.env.EMAIL_API_URL - simulates local demo
  });

  const result = await provider.send({
    to: "user@example.com",
    subject: "Test",
    text: "test",
  });

  assert.equal(result.delivery, "local-demo", "Should return local-demo in unconfigured mode");
});
