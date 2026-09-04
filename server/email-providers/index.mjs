/**
 * Email provider factory. Auto-detects and instantiates the configured provider.
 * 
 * Environment variables (pick one):
 *   - SendGrid: EMAIL_PROVIDER=sendgrid (or auto-detected by EMAIL_API_KEY starting with "SG.")
 *   - AWS SES: EMAIL_PROVIDER=aws-ses
 *   - Generic API: EMAIL_PROVIDER=generic (custom endpoint via EMAIL_API_URL)
 * 
 * Common to all:
 *   - EMAIL_FROM: Sender address (e.g., "Nexa Exchange <security@example.com>")
 */

import { createSendGridAdapter } from "./sendgrid.mjs";
import { createAwsSesAdapter } from "./aws-ses.mjs";

export function getEmailProvider(options = {}) {
  const provider = options.provider || process.env.EMAIL_PROVIDER;
  const apiKey = options.apiKey || process.env.EMAIL_API_KEY;
  const from = options.from || process.env.EMAIL_FROM;
  const fetchImpl = options.fetchImpl || fetch;

  // Auto-detect SendGrid by API key prefix
  if (!provider && apiKey?.startsWith("SG.")) {
    return createSendGridAdapter({ apiKey, from, fetchImpl });
  }

  switch (provider?.toLowerCase()) {
    case "sendgrid":
      return createSendGridAdapter({ apiKey, from, fetchImpl });

    case "aws-ses":
      return createAwsSesAdapter({ region: options.region, accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey, from, fetchImpl });

    case "generic":
    case undefined:
    case null:
      // Generic HTTP-based provider (backward compatible with original mailer)
      return createGenericAdapter({
        apiUrl: options.apiUrl || process.env.EMAIL_API_URL,
        apiKey,
        from,
        fetchImpl,
      });

    default:
      throw new Error(`Unknown email provider: ${provider}`);
  }
}

function createGenericAdapter({ apiUrl, apiKey, from, fetchImpl = fetch } = {}) {
  if (!apiUrl) {
    return { configured: false, send: async () => ({ delivery: "local-demo", provider: "generic-mock" }) };
  }

  if (!apiKey) {
    throw new Error("Generic email provider requires EMAIL_API_KEY.");
  }

  async function send({ to, subject, text, html }) {
    const response = await fetchImpl(apiUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text, html }),
    });

    if (!response.ok) {
      throw new Error(`Email provider rejected the request with HTTP ${response.status}.`);
    }

    return {
      provider: "generic",
      status: "accepted",
      messageId: response.headers?.get?.("x-message-id") || "unknown",
    };
  }

  return { configured: true, send };
}
