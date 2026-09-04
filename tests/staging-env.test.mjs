import assert from "node:assert/strict";
import test from "node:test";
import { validateStagingEnvironment } from "../scripts/validate-staging-env.mjs";

const valid = {
  STAGING_DOMAIN: "staging.nexa.test",
  STAGING_URL: "https://staging.nexa.test",
  POSTGRES_PASSWORD: "owner-password-that-is-long-and-random",
  POSTGRES_APP_PASSWORD: "application-password-long-and-different",
  POSTGRES_MIGRATION_PASSWORD: "migration-password-long-and-also-different",
  MONITORING_TOKEN: "monitoring-token-at-least-thirty-two-characters",
  STAGING_SMOKE_EMAIL: "smoke@staging.nexa.test",
  STAGING_SMOKE_PASSWORD: "dedicated-smoke-password-long-and-random",
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  EMAIL_PROVIDER: "sendgrid",
  EMAIL_API_KEY: "SG.a-real-looking-staging-key",
  EMAIL_FROM: "Nexa Exchange <noreply@nexa.test>",
};

test("staging preflight accepts a complete environment", () => {
  assert.deepEqual(validateStagingEnvironment(valid), { domain: "staging.nexa.test", provider: "sendgrid", smokeEmail: "smoke@staging.nexa.test" });
});

test("staging preflight rejects placeholders, reused passwords, and malformed keys", () => {
  for (const changed of [
    { STAGING_DOMAIN: "exchange-staging.example.com" },
    { POSTGRES_APP_PASSWORD: valid.POSTGRES_PASSWORD },
    { POSTGRES_MIGRATION_PASSWORD: valid.POSTGRES_APP_PASSWORD },
    { DATA_ENCRYPTION_KEY: "not-a-32-byte-key" },
    { MONITORING_TOKEN: "short" },
    { STAGING_SMOKE_EMAIL: "not-an-email" },
    { STAGING_SMOKE_PASSWORD: "short" },
  ]) {
    assert.throws(() => validateStagingEnvironment({ ...valid, ...changed }));
  }
});

test("staging preflight enforces provider-specific email configuration", () => {
  assert.throws(() => validateStagingEnvironment({ ...valid, EMAIL_API_KEY: "wrong" }), /SendGrid/);
  assert.throws(() => validateStagingEnvironment({ ...valid, EMAIL_PROVIDER: "generic", EMAIL_API_URL: "http://mail.nexa.test" }), /HTTPS/);
});
