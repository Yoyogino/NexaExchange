/**
 * SendGrid email provider adapter.
 * 
 * Configuration:
 *   EMAIL_PROVIDER: sendgrid
 *   EMAIL_API_URL: https://api.sendgrid.com/v3/mail/send (optional, auto-set)
 *   EMAIL_API_KEY: SendGrid API key (starts with SG.)
 *   EMAIL_FROM: From address, e.g. "Nexa Exchange <security@example.com>"
 * 
 * Get an API key:
 *   1. Sign up at https://sendgrid.com
 *   2. Go to Settings > API Keys
 *   3. Create a new "Full Access" key
 *   4. Store it in EMAIL_API_KEY environment variable
 */

export function createSendGridAdapter({ apiKey, from, fetchImpl = fetch } = {}) {
  const apiUrl = "https://api.sendgrid.com/v3/mail/send";

  if (!apiKey) {
    throw new Error("SendGrid adapter requires EMAIL_API_KEY environment variable.");
  }

  if (!from) {
    throw new Error("SendGrid adapter requires EMAIL_FROM environment variable (e.g., 'Nexa Exchange <security@example.com>')");
  }

  // Parse "Name <email@example.com>" format
  const fromMatch = from.match(/^(.+?)\s*<(.+?)>$/) || [null, from, from];
  const [, fromName, fromEmail] = fromMatch;

  async function send({ to, subject, text, html }) {
    const payload = {
      from: { email: fromEmail, name: fromName },
      subject,
      content: [{ type: "text/plain", value: text }],
      personalizations: [{ to: [{ email: to }] }],
    };

    if (html) {
      payload.content.push({ type: "text/html", value: html });
    }

    const response = await fetchImpl(apiUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`SendGrid rejected the request with HTTP ${response.status}.`);
    }

    return {
      provider: "sendgrid",
      status: "accepted",
      messageId: response.headers.get("x-message-id") || "unknown",
    };
  }

  return { configured: true, send };
}
