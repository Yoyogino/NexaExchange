#!/usr/bin/env node

/**
 * Generate secure secrets for staging deployment
 * Run: node scripts/generate-staging-secrets.mjs
 */

import crypto from 'crypto';

function generateBase64Key(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64');
}

function generateSecurePassword(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

function generateMonitoringToken(length = 32) {
  return crypto.randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);
}

console.log('🔐 Nexa Staging Secrets Generator\n');
console.log('Copy these values into your .env.staging file:\n');

console.log('=== DATABASE PASSWORDS ===');
console.log(`POSTGRES_PASSWORD=${generateSecurePassword()}`);
console.log(`POSTGRES_APP_PASSWORD=${generateSecurePassword()}`);
console.log(`POSTGRES_MIGRATION_PASSWORD=${generateSecurePassword()}\n`);

console.log('=== ENCRYPTION KEYS (Base64-encoded 32-byte values) ===');
console.log(`DATA_ENCRYPTION_KEY=${generateBase64Key(32)}`);
console.log(`BACKUP_ENCRYPTION_KEY=${generateBase64Key(32)}\n`);

console.log('=== MONITORING ===');
console.log(`MONITORING_TOKEN=${generateMonitoringToken(32)}\n`);

console.log('=== SMOKE TEST ACCOUNT ===');
console.log(`STAGING_SMOKE_EMAIL=smoke-test@yourdomain.com  # Update this!`);
console.log(`STAGING_SMOKE_PASSWORD=${generateSecurePassword()}\n`);

console.log('=== DOMAIN CONFIGURATION ===');
console.log('STAGING_DOMAIN=shopboostlabs.com');
console.log('STAGING_URL=https://shopboostlabs.com\n');

console.log('=== EMAIL PROVIDER (AWS SES) ===');
console.log('EMAIL_PROVIDER=aws-ses');
console.log('AWS_REGION=us-east-1  # Update if different');
console.log('AWS_ACCESS_KEY_ID=AKIA... # Your AWS Access Key');
console.log('AWS_SECRET_ACCESS_KEY=... # Your AWS Secret Key');
console.log('EMAIL_FROM=Nexa Exchange <noreply@shopboostlabs.com>\n');

console.log('=== BACKUP CONFIGURATION ===');
console.log('OFFSITE_BACKUP_DIRECTORY=/mnt/secure-offsite/nexa-staging');
console.log('BACKUP_RETENTION_DAYS=14\n');

console.log('✅ Save these values securely (password manager recommended)');
console.log('⚠️  Never commit .env.staging to git');
console.log('⚠️  Never share these values in logs or messages\n');
