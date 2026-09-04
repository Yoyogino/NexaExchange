function required(environment, name) {
  const value = String(environment[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required.`);
  if (/replace-with|example\.com/i.test(value)) throw new Error(`${name} still contains an example placeholder.`);
  return value;
}

function strongSecret(environment, name, minimum = 24) {
  const value = required(environment, name);
  if (value.length < minimum) throw new Error(`${name} must be at least ${minimum} characters.`);
  return value;
}

export function validateStagingEnvironment(environment) {
  const domain = required(environment, "STAGING_DOMAIN");
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)) {
    throw new Error("STAGING_DOMAIN must be a valid public hostname.");
  }

  const stagingUrl = new URL(required(environment, "STAGING_URL"));
  if (stagingUrl.protocol !== "https:" || stagingUrl.hostname !== domain || stagingUrl.pathname !== "/") {
    throw new Error("STAGING_URL must be the HTTPS root URL for STAGING_DOMAIN.");
  }

  const ownerPassword = strongSecret(environment, "POSTGRES_PASSWORD");
  const appPassword = strongSecret(environment, "POSTGRES_APP_PASSWORD");
  const migrationPassword = strongSecret(environment, "POSTGRES_MIGRATION_PASSWORD");
  if (new Set([ownerPassword, appPassword, migrationPassword]).size !== 3) throw new Error("Database owner, migration, and application passwords must be different.");
  strongSecret(environment, "MONITORING_TOKEN", 32);
  const smokeEmail = required(environment, "STAGING_SMOKE_EMAIL").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(smokeEmail)) throw new Error("STAGING_SMOKE_EMAIL must be a valid email address.");
  strongSecret(environment, "STAGING_SMOKE_PASSWORD", 16);

  const encryptionKey = required(environment, "DATA_ENCRYPTION_KEY");
  let decodedKey;
  try { decodedKey = Buffer.from(encryptionKey, "base64"); } catch { throw new Error("DATA_ENCRYPTION_KEY must be base64 encoded."); }
  if (decodedKey.length !== 32 || decodedKey.toString("base64").replace(/=+$/, "") !== encryptionKey.replace(/=+$/, "")) {
    throw new Error("DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }

  required(environment, "EMAIL_FROM");
  const provider = required(environment, "EMAIL_PROVIDER").toLowerCase();
  if (provider === "sendgrid") {
    if (!required(environment, "EMAIL_API_KEY").startsWith("SG.")) throw new Error("SendGrid EMAIL_API_KEY must begin with SG.");
  } else if (provider === "aws-ses") {
    required(environment, "AWS_REGION");
    required(environment, "AWS_ACCESS_KEY_ID");
    required(environment, "AWS_SECRET_ACCESS_KEY");
  } else if (provider === "generic") {
    const apiUrl = new URL(required(environment, "EMAIL_API_URL"));
    if (apiUrl.protocol !== "https:") throw new Error("Generic EMAIL_API_URL must use HTTPS.");
    strongSecret(environment, "EMAIL_API_KEY");
  } else {
    throw new Error("EMAIL_PROVIDER must be sendgrid, aws-ses, or generic.");
  }

  return { domain, provider, smokeEmail };
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) {
  const result = validateStagingEnvironment(process.env);
  console.log(`Staging environment preflight passed for ${result.domain} using ${result.provider}.`);
}
