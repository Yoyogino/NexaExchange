# Email Delivery Setup Guide

This guide explains how to configure transactional email delivery for Nexa Exchange (verification codes, password resets, etc.).

## Quick Start: SendGrid (Recommended)

SendGrid is the simplest option for most setups.

### 1. Create a SendGrid Account

1. Sign up at https://sendgrid.com
2. Complete email verification
3. Go to **Settings** → **API Keys**
4. Click **Create API Key**
5. Name it (e.g., "Nexa Exchange") and select **Full Access**
6. Copy the key (it starts with `SG.`)

### 2. Configure Environment Variables

Add to your `.env` file (or production secrets):

```bash
# SendGrid configuration
EMAIL_PROVIDER=sendgrid
EMAIL_API_KEY=SG.your_sendgrid_key_here
EMAIL_FROM="Nexa Exchange <noreply@example.com>"
```

**Note:** The email address in `EMAIL_FROM` must either:
- Be a verified individual sender (for low volume)
- Use a verified domain (for production)

### 3. Verify Your Sender

In SendGrid dashboard:
1. Go to **Settings** → **Sender Authentication**
2. Click **Verify a Single Sender**
3. Enter your sender details
4. Check the verification email and confirm

### 4. Test Email Delivery

```bash
node --env-file=.env server/scripts/send-test-email.mjs
```

---

## AWS SES Setup

AWS SES is suitable for high-volume production deployments.

### 1. Create an AWS Account and Enable SES

1. Sign up at https://aws.amazon.com
2. Go to **SES** service
3. Select your region (e.g., us-east-1)
4. Go to **Account Dashboard** and note the region

### 2. Verify Sender Email or Domain

**Option A: Individual Email Verification** (quick, limited to testing)

1. Go to **Account Dashboard** → **Verified identities**
2. Click **Create identity**
3. Choose **Email address** type
4. Enter your sender email (e.g., `noreply@example.com`)
5. Check the verification email and confirm

**Option B: Domain Verification** (required for production)

1. Go to **Account Dashboard** → **Verified identities**
2. Click **Create identity**
3. Choose **Domain** type
4. Enter your domain (e.g., `example.com`)
5. Add the DKIM CNAME records to your domain DNS
6. Wait for verification (can take 24+ hours)

### 3. Create an IAM User with SES Permissions

1. Go to **IAM** → **Users**
2. Click **Create user**
3. Name it (e.g., `nexa-exchange`)
4. Click **Attach policies directly**
5. Search for `AmazonSESFullAccess` and select it
6. Click **Create user**
7. Click on the user and go to **Security credentials**
8. Click **Create access key**
9. Choose **Application running outside AWS**
10. Copy the Access Key ID and Secret Access Key

### 4. Configure Environment Variables

```bash
# AWS SES configuration
EMAIL_PROVIDER=aws-ses
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA1234567890ABCDEF
AWS_SECRET_ACCESS_KEY=your_secret_key_here
EMAIL_FROM="Nexa Exchange <noreply@example.com>"
```

### 5. Request Production Access

SES accounts start in **Sandbox Mode**, which limits sending:
- Only verified recipients
- 1 email per second max
- 50 emails per 24 hours

To use in production, request **Production Access**:

1. Go to **Account Dashboard**
2. Click **Request Production Access**
3. Answer the questionnaire
4. Wait for approval (typically 24 hours)

### 6. Test Email Delivery

```bash
node --env-file=.env server/scripts/send-test-email.mjs
```

---

## Generic API Provider

For custom email providers not listed above, use the generic HTTP adapter:

```bash
EMAIL_PROVIDER=generic
EMAIL_API_URL=https://api.your-provider.com/send
EMAIL_API_KEY=your_api_key_here
EMAIL_FROM="Nexa Exchange <noreply@example.com>"
```

The request format sent to your API:

```json
{
  "from": "noreply@example.com",
  "to": ["user@example.com"],
  "subject": "Verify your Nexa Exchange account",
  "text": "Your verification code is 123456. It expires in 15 minutes.",
  "html": "Optional HTML version"
}
```

---

## Configuration Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EMAIL_PROVIDER` | No | Auto-detect | Provider type: `sendgrid`, `aws-ses`, `generic` |
| `EMAIL_FROM` | Yes | N/A | Sender address: `"Name <email@example.com>"` |
| `EMAIL_API_KEY` | Depends | N/A | API key (SendGrid, generic) |
| `AWS_REGION` | For SES | `us-east-1` | AWS region for SES |
| `AWS_ACCESS_KEY_ID` | For SES | N/A | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | For SES | N/A | AWS secret key |
| `EMAIL_API_URL` | For generic | N/A | Custom email API endpoint |

---

## Local Development (No Email)

If you don't configure email provider, Nexa will run in **demo mode** where emails are logged to console but not delivered:

```
[EMAIL LOCAL-DEMO] To: user@example.com
Subject: Verify your Nexa Exchange account
Your verification code is 123456. It expires in 15 minutes.
```

---

## Production Checklist

- [ ] Email provider configured (SendGrid or AWS SES recommended)
- [ ] Sender email verified with provider
- [ ] `EMAIL_FROM` uses verified sender address
- [ ] Test email delivery with `send-test-email.mjs` script
- [ ] API key/secrets stored securely (not in source code)
- [ ] Email rate limits configured (if applicable)
- [ ] Bounce handling configured in email provider
- [ ] Unsubscribe link added to email templates (legal requirement)
- [ ] Email logging configured for audit trail
- [ ] Bounce/complaint callbacks configured in provider

---

## Troubleshooting

### "Temporary failure in name resolution"

Email provider API unreachable. Check:
- Network connectivity
- Firewall/proxy settings
- API endpoint URL is correct

### "Unauthorized" / "Invalid API Key"

Check:
- API key is correct and not expired
- API key has correct permissions
- API key is for the correct region (AWS SES)

### Email not received

Check:
- Sender email is verified with provider
- Recipient email is valid
- Provider is not in sandbox mode (AWS SES)
- Check email provider's delivery logs
- Check spam folder

### High bounce rate

Check:
- Recipient email list is clean
- Email content is not triggering spam filters
- Verify SPF/DKIM records are configured

---

## Testing

Run the email provider tests:

```bash
npm test tests/email-providers.test.mjs
```

Send a test email to verify configuration:

```bash
node --env-file=.env server/scripts/send-test-email.mjs user@example.com
```

---

## Security Considerations

- Never commit API keys to source control
- Use `.env.local` and `.env.example` pattern
- Rotate API keys regularly
- Enable IP whitelisting in email provider if available
- Use separate API keys for staging and production
- Monitor API key usage and set up alerts
