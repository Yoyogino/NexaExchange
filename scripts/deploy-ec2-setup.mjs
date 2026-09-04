#!/usr/bin/env node

/**
 * EC2 Deployment Setup Helper
 * 
 * This script generates:
 * 1. AWS CLI commands to launch EC2 instance
 * 2. User data script to auto-install Docker
 * 3. Deployment verification checklist
 */

import fs from 'fs';
import path from 'path';

const AWS_REGION = 'us-east-1';
const INSTANCE_TYPE = 't2.micro';
const INSTANCE_NAME = 'nexa-staging';
const VOLUME_SIZE = 30;

console.log(`
╔════════════════════════════════════════════════════════════════╗
║           AWS EC2 Staging Deployment Setup                     ║
║                                                                ║
║  Instance Type: ${INSTANCE_TYPE} (Free tier eligible)                ║
║  Region: ${AWS_REGION}                                                ║
║  Estimated Cost: ~$5/month                                    ║
╚════════════════════════════════════════════════════════════════╝
`);

// Generate user data script for EC2
const userDataScript = `#!/bin/bash
set -e

echo "=== Nexa Staging - EC2 Setup Start ==="
date

# Update system
apt-get update
apt-get upgrade -y

# Install Docker
apt-get install -y docker.io docker-compose git curl

# Add ubuntu user to docker group
usermod -aG docker ubuntu
newgrp docker

# Create application directory
mkdir -p /home/ubuntu/crypto-exchange
chown ubuntu:ubuntu /home/ubuntu/crypto-exchange

# Enable Docker daemon
systemctl enable docker
systemctl start docker

echo "=== Docker Installation Complete ==="
docker --version
docker compose --version

echo "=== Nexa Staging - EC2 Setup Complete ==="
echo "Ready for application deployment"
`;

// Generate AWS CLI command
const awsCliCommand = `aws ec2 run-instances \\
  --image-id ami-0885b1f6bd170450c \\
  --instance-type ${INSTANCE_TYPE} \\
  --key-name nexa-staging \\
  --security-groups nexa-staging-sg \\
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=${VOLUME_SIZE},VolumeType=gp3,DeleteOnTermination=true}' \\
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=${INSTANCE_NAME}},{Key=Environment,Value=staging}]' \\
  --user-data file://ec2-user-data.sh \\
  --monitoring Enabled=true \\
  --region ${AWS_REGION}
`;

// Generate deployment script for EC2
const deploymentScript = `#!/bin/bash
set -e

cd /home/ubuntu/crypto-exchange

echo "=== Deploying Nexa Crypto Exchange ==="
date

# Source environment
export $(cat .env.staging | grep -v '^#' | xargs)

# Build Docker images
echo "Building Docker images..."
docker compose --env-file .env.staging -f compose.staging.yml build

# Start services
echo "Starting services..."
docker compose --env-file .env.staging -f compose.staging.yml up -d

# Wait for services to be healthy
echo "Waiting for services to be ready..."
sleep 10

# Check status
docker compose --env-file .env.staging -f compose.staging.yml ps

# Verify API is responding
echo "Testing API endpoint..."
curl -f http://localhost:3001/api/ready || echo "API still starting..."

echo "=== Deployment Complete ==="
echo "API available at: http://${PUBLIC_IP}:3001"
echo "Staging URL: https://\${STAGING_DOMAIN}"
`;

// Create output files
const outputDir = '.deployment';
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

// Write user data script
fs.writeFileSync(path.join(outputDir, 'ec2-user-data.sh'), userDataScript);
console.log('✓ Generated: .deployment/ec2-user-data.sh');

// Write AWS CLI command
fs.writeFileSync(path.join(outputDir, 'aws-cli-command.sh'), awsCliCommand);
console.log('✓ Generated: .deployment/aws-cli-command.sh');

// Write deployment script
fs.writeFileSync(path.join(outputDir, 'deploy-app.sh'), deploymentScript);
console.log('✓ Generated: .deployment/deploy-app.sh');

// Generate step-by-step guide
const stepByStepGuide = `# AWS EC2 Deployment - Step by Step

## Step 1: Create SSH Key Pair (If you don't have one)

\`\`\`bash
# Run this in AWS Console or AWS CLI:
aws ec2 create-key-pair \\
  --key-name nexa-staging \\
  --region ${AWS_REGION} \\
  --query 'KeyMaterial' \\
  --output text > nexa-staging.pem

# Secure the key
chmod 600 nexa-staging.pem
\`\`\`

## Step 2: Create Security Group

\`\`\`bash
aws ec2 create-security-group \\
  --group-name nexa-staging-sg \\
  --description "Nexa Crypto Exchange Staging" \\
  --region ${AWS_REGION}

# Allow SSH
aws ec2 authorize-security-group-ingress \\
  --group-name nexa-staging-sg \\
  --protocol tcp \\
  --port 22 \\
  --cidr 0.0.0.0/0 \\
  --region ${AWS_REGION}

# Allow HTTP
aws ec2 authorize-security-group-ingress \\
  --group-name nexa-staging-sg \\
  --protocol tcp \\
  --port 80 \\
  --cidr 0.0.0.0/0 \\
  --region ${AWS_REGION}

# Allow HTTPS
aws ec2 authorize-security-group-ingress \\
  --group-name nexa-staging-sg \\
  --protocol tcp \\
  --port 443 \\
  --cidr 0.0.0.0/0 \\
  --region ${AWS_REGION}
\`\`\`

## Step 3: Launch EC2 Instance

Option A: Using AWS Console
1. Go to https://console.aws.amazon.com/ec2/
2. Click "Launch Instances"
3. Search for "Ubuntu 22.04 LTS" (ami-0885b1f6bd170450c)
4. Select t2.micro (free tier eligible)
5. Key pair: nexa-staging
6. Security group: nexa-staging-sg
7. Storage: 30 GB, gp3
8. Advanced > User data: Paste contents of ec2-user-data.sh
9. Launch instance

Option B: Using AWS CLI
\`\`\`bash
bash .deployment/aws-cli-command.sh
\`\`\`

## Step 4: Get Instance Details

\`\`\`bash
# Get instance IP and details
aws ec2 describe-instances \\
  --filters "Name=tag:Name,Values=${INSTANCE_NAME}" \\
  --region ${AWS_REGION} \\
  --query 'Reservations[0].Instances[0].[InstanceId,PublicIpAddress,State.Name]' \\
  --output table
\`\`\`

## Step 5: Connect to Instance

\`\`\`bash
# Wait 2-3 minutes for user data script to complete

# From Windows PowerShell:
ssh -i nexa-staging.pem ubuntu@YOUR_PUBLIC_IP

# From Linux/Mac:
ssh -i nexa-staging.pem ubuntu@YOUR_PUBLIC_IP

# Inside EC2, verify Docker is installed:
docker --version
docker ps
\`\`\`

## Step 6: Deploy Application

\`\`\`bash
# From your local machine, copy files to EC2:
scp -i nexa-staging.pem -r . ubuntu@YOUR_PUBLIC_IP:~/crypto-exchange/

# Connect to EC2
ssh -i nexa-staging.pem ubuntu@YOUR_PUBLIC_IP

# Deploy
cd ~/crypto-exchange
bash .deployment/deploy-app.sh
\`\`\`

## Step 7: Verify Deployment

\`\`\`bash
# Check containers
docker compose --env-file .env.staging -f compose.staging.yml ps

# Test API
curl http://localhost:3001/api/ready

# View logs
docker compose --env-file .env.staging -f compose.staging.yml logs app
\`\`\`

## Step 8: Configure DNS (Optional)

After deployment, point your domain to the instance's public IP:

\`\`\`
Domain: shopboostlabs.com
Type: A
Value: YOUR_PUBLIC_IP
TTL: 300
\`\`\`

Wait 5-10 minutes for DNS to propagate, then test:
\`\`\`bash
curl -I https://shopboostlabs.com
\`\`\`

---

## Troubleshooting

### Instance not launching?
- Check AWS free tier eligibility
- Verify security group exists
- Check key pair name is correct

### Can't SSH into instance?
- Wait 2-3 minutes for instance to start
- Verify security group allows port 22
- Check key permissions: chmod 600 nexa-staging.pem
- Verify correct username (ubuntu for Ubuntu AMI)

### Docker not installed?
- User data script may still be running
- SSH in and run: sudo apt install -y docker.io docker-compose
- Check: sudo tail -f /var/log/cloud-init-output.log

### Containers won't start?
- Check .env.staging is copied correctly
- Verify permissions: chmod 600 .env.staging
- Check logs: docker compose logs

---

**Instance Details:**
- Instance Type: ${INSTANCE_TYPE} (750 hrs/month free)
- Region: ${AWS_REGION}
- Volume: ${VOLUME_SIZE}GB gp3
- Cost: Free tier eligible

**Next Steps:**
1. Create SSH key pair (if needed)
2. Create security group
3. Launch EC2 instance
4. Wait 2-3 minutes for Docker installation
5. Deploy application
6. Configure DNS (optional)
`;

fs.writeFileSync(path.join(outputDir, 'DEPLOYMENT_STEPS.md'), stepByStepGuide);
console.log('✓ Generated: .deployment/DEPLOYMENT_STEPS.md');

// Create a summary file
const summary = `
╔════════════════════════════════════════════════════════════════╗
║           Deployment Files Generated                           ║
╚════════════════════════════════════════════════════════════════╝

Location: .deployment/

Files:
  ✓ ec2-user-data.sh       - Auto-install Docker on EC2
  ✓ aws-cli-command.sh     - AWS CLI to launch instance
  ✓ deploy-app.sh          - Deploy application script
  ✓ DEPLOYMENT_STEPS.md    - Step-by-step guide

Next Actions:
  1. Review DEPLOYMENT_STEPS.md
  2. Create SSH key pair (if needed)
  3. Create security group
  4. Launch EC2 instance
  5. Wait 2-3 minutes for Docker setup
  6. Deploy application files
  7. Start services

Estimated Time: 30-45 minutes
Estimated Cost: Free (t2.micro free tier eligible)

For detailed instructions, see: .deployment/DEPLOYMENT_STEPS.md
`;

console.log(summary);

// Save summary
fs.writeFileSync(path.join(outputDir, 'READY.txt'), summary);

console.log('\n✅ All deployment files ready!\n');
