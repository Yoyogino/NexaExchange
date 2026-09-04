#!/usr/bin/env node

import { createMailer } from "../server/mailer.mjs";

console.log('\n🔍 Testing AWS SES Email Configuration...\n');

try {
  const mailer = createMailer({
    provider: process.env.EMAIL_PROVIDER,
    from: process.env.EMAIL_FROM,
  });

  if (!mailer.configured) {
    console.log('⚠️  Email provider is not configured');
    console.log('   In production, this would be an error.');
    console.log('   In development, emails fall back to local-demo mode.');
    console.log('\n✅ Local demo mode is ready (no real emails sent)\n');
    process.exit(0);
  }

  console.log('✅ Email Provider Configuration:');
  console.log(`   Provider: ${process.env.EMAIL_PROVIDER}`);
  console.log(`   From: ${process.env.EMAIL_FROM}`);
  console.log(`   Region: ${process.env.AWS_REGION}`);
  
  // Test sending verification code
  const testEmail = process.env.STAGING_SMOKE_EMAIL || 'smoke-test@shopboostlabs.com';
  console.log(`\n📧 Testing verification email to ${testEmail}...`);
  
  const result = await mailer.sendVerificationCode(testEmail, '123456');
  console.log(`   ✓ Verification email test: ${result.delivery}`);

  // Test sending password reset code
  console.log(`\n📧 Testing password reset email to ${testEmail}...`);
  const resetResult = await mailer.sendPasswordResetCode(testEmail, '654321');
  console.log(`   ✓ Password reset email test: ${resetResult.delivery}`);

  console.log('\n✅ Email Service is Ready!\n');
  console.log('📋 Summary:');
  console.log(`   - Provider: ${process.env.EMAIL_PROVIDER}`);
  console.log(`   - Sender: ${process.env.EMAIL_FROM}`);
  console.log(`   - Test Recipient: ${testEmail}`);
  console.log(`   - Status: CONFIGURED AND READY`);
  
  process.exit(0);
  
} catch (error) {
  console.error('\n❌ Email Configuration Error:');
  console.error(`   ${error.message}`);
  
  console.log('\n⚠️  Troubleshooting:');
  console.log('   1. Check that AWS credentials are valid: .env.staging');
  console.log('   2. Verify sender email in AWS SES console');
  console.log('   3. Ensure EMAIL_PROVIDER=aws-ses is set');
  console.log('   4. Check that AWS_REGION is correct (us-east-1)');
  
  process.exit(1);
}
