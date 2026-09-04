#!/usr/bin/env node
/**
 * Send a test email to verify provider configuration.
 * Usage: node send-test-email.mjs [recipient@example.com]
 */

import { getEmailProvider } from "../email-providers/index.mjs";

const recipient = process.argv[2] || "test@example.com";
const provider = getEmailProvider();

console.log("📧 Sending test email...");
console.log(`   Provider:  ${process.env.EMAIL_PROVIDER || "auto-detect"}`);
console.log(`   From:      ${process.env.EMAIL_FROM || "demo@example.com"}`);
console.log(`   To:        ${recipient}`);
console.log();

try {
  const result = await provider.send({
    to: recipient,
    subject: "Nexa Exchange - Email Test",
    text: `This is a test email from Nexa Exchange.

Timestamp: ${new Date().toISOString()}
Provider: ${process.env.EMAIL_PROVIDER || "demo"}

If you received this email, your email configuration is working correctly!`,
    html: `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: sans-serif; line-height: 1.5;">
      <h2>Nexa Exchange - Email Test</h2>
      <p>This is a test email from Nexa Exchange.</p>
      <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
      <p><strong>Provider:</strong> ${process.env.EMAIL_PROVIDER || "demo"}</p>
      <p>If you received this email, your email configuration is working correctly!</p>
    </body>
    </html>
    `,
  });

  console.log("✅ Email sent successfully!");
  console.log();
  console.log("Response:");
  console.log(JSON.stringify(result, null, 2));
  console.log();
  console.log("Check your inbox (and spam folder) for the test email.");
} catch (error) {
  console.error("❌ Failed to send email:");
  console.error(error.message);
  process.exit(1);
}
