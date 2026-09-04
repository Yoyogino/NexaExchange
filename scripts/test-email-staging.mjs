#!/usr/bin/env node

import { SESClient, GetAccountSendingEnabledStatusCommand, ListVerifiedEmailAddressesCommand, SendEmailCommand } from '@aws-sdk/client-ses';
import { config } from 'dotenv';

config({ path: '.env.staging' });

const sesClient = new SESClient({ 
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});

async function testEmailStaging() {
  console.log('\n🔍 Testing AWS SES Configuration...\n');
  
  try {
    // Check if SES is enabled for the account
    console.log('1️⃣  Checking if SES is enabled...');
    const statusCmd = new GetAccountSendingEnabledStatusCommand({});
    const statusResult = await sesClient.send(statusCmd);
    console.log(`   ✓ SES Enabled: ${statusResult.Enabled}`);
    
    // List verified email addresses
    console.log('\n2️⃣  Listing verified email addresses...');
    const verifiedCmd = new ListVerifiedEmailAddressesCommand({});
    const verifiedResult = await sesClient.send(verifiedCmd);
    console.log(`   ✓ Verified Addresses: ${verifiedResult.VerifiedEmailAddresses?.length || 0}`);
    
    if (verifiedResult.VerifiedEmailAddresses?.length) {
      verifiedResult.VerifiedEmailAddresses.forEach(email => {
        console.log(`     - ${email}`);
      });
    } else {
      console.log('\n   ⚠️  WARNING: No verified email addresses found!');
      console.log('   You must verify your sender email in AWS SES before sending.');
      console.log(`   Configure your email in AWS SES console: https://console.aws.amazon.com/sesv2/`);
      return false;
    }
    
    // Extract email from EMAIL_FROM
    const emailMatch = process.env.EMAIL_FROM?.match(/<(.+?)>/);
    const senderEmail = emailMatch ? emailMatch[1] : process.env.EMAIL_FROM;
    
    console.log(`\n3️⃣  Sender Email: ${senderEmail}`);
    
    if (!verifiedResult.VerifiedEmailAddresses?.includes(senderEmail)) {
      console.log(`   ⚠️  WARNING: Sender email ${senderEmail} is NOT verified!`);
      console.log(`   Please verify it in AWS SES before attempting to send emails.`);
      return false;
    }
    
    console.log(`   ✓ Sender email is verified`);
    
    // Test sending a simple email
    console.log('\n4️⃣  Sending test email...');
    const testEmail = process.env.STAGING_SMOKE_EMAIL || 'smoke-test@shopboostlabs.com';
    
    const sendCmd = new SendEmailCommand({
      Source: senderEmail,
      Destination: {
        ToAddresses: [testEmail],
      },
      Message: {
        Subject: {
          Data: '[Nexa Staging] Test Email - ' + new Date().toISOString(),
          Charset: 'UTF-8',
        },
        Body: {
          Text: {
            Data: `
Nexa Exchange Staging - Test Email
===================================

Timestamp: ${new Date().toISOString()}
Domain: ${process.env.STAGING_DOMAIN}
Region: ${process.env.AWS_REGION}

This is a test email to verify AWS SES is properly configured.

If you received this, email delivery is working! ✓
            `.trim(),
            Charset: 'UTF-8',
          },
        },
      },
    });
    
    const sendResult = await sesClient.send(sendCmd);
    console.log(`   ✓ Email sent successfully!`);
    console.log(`   Message ID: ${sendResult.MessageId}`);
    
    console.log('\n✅ AWS SES Configuration is READY for staging!\n');
    console.log('📋 Summary:');
    console.log(`   - SES Status: ENABLED`);
    console.log(`   - Verified Sender: ${senderEmail}`);
    console.log(`   - Test Email Recipient: ${testEmail}`);
    console.log(`   - Region: ${process.env.AWS_REGION}`);
    console.log(`   - Message ID: ${sendResult.MessageId}`);
    
    return true;
    
  } catch (error) {
    console.error('\n❌ AWS SES Test Failed:');
    console.error(`   Error: ${error.message}`);
    
    if (error.code === 'InvalidParameterValue') {
      console.error('\n   This usually means:');
      console.error('   - AWS credentials are invalid');
      console.error('   - Sender email is not verified in SES');
      console.error('   - Region is incorrect');
    }
    
    return false;
  }
}

const success = await testEmailStaging();
process.exit(success ? 0 : 1);
