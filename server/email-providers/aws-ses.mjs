/**
 * AWS SES (Simple Email Service) email provider adapter.
 * 
 * Configuration:
 *   EMAIL_PROVIDER: aws-ses
 *   AWS_REGION: AWS region (default: us-east-1)
 *   AWS_ACCESS_KEY_ID: AWS access key ID
 *   AWS_SECRET_ACCESS_KEY: AWS secret access key
 *   EMAIL_FROM: From address, must be verified in SES (e.g., "Nexa Exchange <security@example.com>")
 * 
 * Setup:
 *   1. Create an AWS account and enable SES
 *   2. Verify your sender email domain or address
 *   3. Create an IAM user with SES:SendEmail permission
 *   4. Store credentials in environment variables
 * 
 * Note: SES requires email addresses to be verified before sending.
 */

import crypto from "node:crypto";

function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function hash(data) {
  return crypto.createHash("sha256").update(data).digest();
}

export function createAwsSesAdapter({
  region = process.env.AWS_REGION || "us-east-1",
  accessKeyId = process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY,
  from = process.env.EMAIL_FROM,
  fetchImpl = fetch,
} = {}) {
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("AWS SES adapter requires AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.");
  }

  if (!from) {
    throw new Error("AWS SES adapter requires EMAIL_FROM environment variable (must be verified in SES).");
  }

  async function send({ to, subject, text, html }) {
    const host = `email.${region}.amazonaws.com`;
    const service = "email";
    const method = "POST";
    const action = "SendEmail";
    const version = "2010-12-01";
    const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");

    // Build form-encoded payload
    const payload = new URLSearchParams({
      Action: action,
      Source: from,
      "Destination.ToAddresses.member.1": to,
      "Message.Subject.Data": subject,
      "Message.Body.Text.Data": text,
    });

    if (html) {
      payload.append("Message.Body.Html.Data", html);
    }

    // AWS Signature Version 4
    const algorithm = "AWS4-HMAC-SHA256";
    const credentialScope = `${timestamp.slice(0, 8)}/${region}/${service}/aws4_request`;
    const hashedPayload = hash(payload.toString());
    const canonicalRequest = [
      method,
      "/",
      "",
      `host:${host}\nx-amz-date:${timestamp}`,
      "",
      hashedPayload.toString("hex"),
    ].join("\n");

    const hashedCanonicalRequest = hash(canonicalRequest);
    const stringToSign = [algorithm, timestamp, credentialScope, hashedCanonicalRequest.toString("hex")].join("\n");

    const kDate = hmac(`AWS4${secretAccessKey}`, timestamp.slice(0, 8));
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, service);
    const kSigning = hmac(kService, "aws4_request");
    const signature = hmac(kSigning, stringToSign).toString("hex");

    const authorization = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=host;x-amz-date, Signature=${signature}`;

    const response = await fetchImpl(`https://${host}/`, {
      method,
      headers: {
        "host": host,
        "x-amz-date": timestamp,
        "authorization": authorization,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: payload.toString(),
    });

    if (!response.ok) {
      throw new Error(`AWS SES rejected the request with HTTP ${response.status}.`);
    }

    const body = await response.text();
    const messageIdMatch = body.match(/<MessageId>([^<]+)<\/MessageId>/);
    const messageId = messageIdMatch ? messageIdMatch[1] : "unknown";

    return {
      provider: "aws-ses",
      status: "accepted",
      messageId,
      region,
    };
  }

  return { configured: true, send };
}
