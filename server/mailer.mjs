import { getEmailProvider } from "./email-providers/index.mjs";
import crypto from "node:crypto";

const isProduction = process.env.NODE_ENV === "production";

export function createMailer({
  apiUrl = process.env.EMAIL_API_URL,
  apiKey = process.env.EMAIL_API_KEY,
  from = process.env.EMAIL_FROM,
  provider = process.env.EMAIL_PROVIDER,
  fetchImpl = fetch,
} = {}) {
  let emailProvider;
  let configured = false;

  try {
    // Use new provider system with fallback to legacy generic provider
    emailProvider = getEmailProvider({ provider, apiUrl, apiKey, from, fetchImpl });
    configured = Boolean(emailProvider && emailProvider.configured !== false);
  } catch (error) {
    if (isProduction) throw error;
    // In development, allow unconfigured mode
    configured = false;
  }

  if (isProduction && !configured) {
    throw new Error("Production email delivery requires configuration. See docs/EMAIL_SETUP.md");
  }

  async function deliver({ to, subject, text }) {
    if (!configured || !emailProvider) {
      return { delivery: "local-demo" };
    }

    try {
      const result = await emailProvider.send({ to, subject, text });
      return { delivery: result.delivery || "email" };
    } catch (error) {
      const recipientHash = crypto.createHash("sha256").update(String(to).trim().toLowerCase()).digest("hex").slice(0, 16);
      console.error(JSON.stringify({ event: "email_delivery_failed", recipientHash, template: subject.startsWith("Verify") ? "verification" : "password_reset", errorType: error?.name ?? "Error" }));
      if (isProduction) throw error;
      return { delivery: "local-demo" };
    }
  }

  return {
    configured,
    sendVerificationCode: (to, code) => deliver({ 
      to, 
      subject: "Verify your Nexa Exchange account", 
      text: `Your verification code is ${code}. It expires in 15 minutes.` 
    }),
    sendPasswordResetCode: (to, code) => deliver({ 
      to, 
      subject: "Reset your Nexa Exchange password", 
      text: `Your password reset code is ${code}. It expires in 15 minutes.` 
    }),
  };
}
