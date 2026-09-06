import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

export function createAwsSesAdapter({
  region = process.env.AWS_REGION || "us-east-1",
  from = process.env.EMAIL_FROM,
  configurationSetName = process.env.SES_CONFIGURATION_SET,
  client = new SESClient({ region }),
} = {}) {
  if (!from) {
    throw new Error("AWS SES adapter requires EMAIL_FROM (the address or domain must be verified in SES).");
  }

  async function send({ to, subject, text, html }) {
    const body = { Text: { Charset: "UTF-8", Data: text } };
    if (html) body.Html = { Charset: "UTF-8", Data: html };

    const input = {
      Source: from,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Charset: "UTF-8", Data: subject },
        Body: body,
      },
    };
    if (configurationSetName) input.ConfigurationSetName = configurationSetName;

    const result = await client.send(new SendEmailCommand(input));

    return {
      provider: "aws-ses",
      status: "accepted",
      messageId: result.MessageId ?? "unknown",
      region,
    };
  }

  return { configured: true, send };
}
