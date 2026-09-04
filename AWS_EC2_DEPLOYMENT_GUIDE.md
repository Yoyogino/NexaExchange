# AWS EC2 Staging Deployment Guide

**Objective:** Deploy Nexa Crypto Exchange staging environment to AWS EC2

**Timeline:** 30-45 minutes  
**Cost:** ~$5/month (t2.micro eligible for free tier)

---

## 📋 Prerequisites Checklist

- [x] Local staging environment tested (COMPLETE)
- [x] Docker Compose configuration ready
- [x] `.env.staging` file with all secrets
- [x] AWS SES credentials configured
- [ ] AWS account with EC2 access
- [ ] SSH key pair created
- [ ] Security group created
- [ ] DNS records configured (optional - can use IP initially)

---

## 🎯 Step 1: Create AWS EC2 Instance

### 1.1 Launch Instance

1. Go to AWS Console: https://console.aws.amazon.com/ec2/
2. Click **Launch Instances**
3. **Name:** `nexa-staging`
4. **AMI:** Ubuntu 22.04 LTS (ami-0885b1f6bd170450c in us-east-1)
5. **Instance Type:** `t2.micro` (free tier eligible)
6. **Key Pair:** Create new or select existing

### 1.2 Network Configuration

1. **VPC:** Default or create new
2. **Subnet:** Choose availability zone
3. **Auto-assign Public IP:** Enable
4. **Security Group:** Create new with rules:
   ```
   SSH:   0.0.0.0/0 :22      (or your IP only)
   HTTP:  0.0.0.0/0 :80      (anyone)
   HTTPS: 0.0.0.0/0 :443     (anyone)
   ```

### 1.3 Storage

- **Size:** 30 GB (default)
- **Type:** gp3 (general purpose)
- **Delete on Termination:** Yes (for testing)

### 1.4 Advanced Details

- **Monitoring:** Enable detailed CloudWatch monitoring
- **Tenancy:** Default
- **Shutdown behavior:** Stop

---

## 🔐 Step 2: Connect to Instance

### 2.1 Get Instance Details

```bash
# From AWS Console:
# - Get Public IPv4 address (e.g., 54.123.45.67)
# - Download .pem key file (e.g., nexa-staging.pem)
```

### 2.2 Connect via SSH (From Windows PowerShell)

```powershell
# Set key permissions (Windows)
$keyPath = "C:\path\to\nexa-staging.pem"
icacls $keyPath /inheritance:r /grant:r "$env:USERNAME`:F"

# Connect to instance
ssh -i $keyPath ubuntu@54.123.45.67
```

### 2.3 First Time Setup

```bash
# Update system packages
sudo apt update
sudo apt upgrade -y

# Install Docker and Docker Compose
sudo apt install -y docker.io docker-compose git

# Add ubuntu user to docker group
sudo usermod -aG docker ubuntu
newgrp docker

# Verify Docker installation
docker --version
docker compose --version
```

---

## 📦 Step 3: Deploy Application

### 3.1 Clone Repository (or Copy Files)

```bash
# Option A: Clone from Git
git clone https://github.com/your-repo/crypto-exchange.git
cd crypto-exchange

# Option B: Copy via SCP (from Windows)
scp -i nexa-staging.pem -r "C:\Users\...\Crypto Exchange\*" ubuntu@54.123.45.67:~/crypto-exchange/
```

### 3.2 Set Up Environment

```bash
# Create staging directory
mkdir -p ~/crypto-exchange
cd ~/crypto-exchange

# Copy .env.staging
# ⚠️ SECURE THIS FILE: Never commit to git
# Use a secure method: scp, AWS Secrets Manager, etc.

# On your local machine:
scp -i nexa-staging.pem .env.staging ubuntu@54.123.45.67:~/crypto-exchange/

# On the server:
chmod 600 .env.staging
```

### 3.3 Start Services

```bash
# Build images (or pull from registry)
docker compose --env-file .env.staging -f compose.staging.yml build

# Start all services
docker compose --env-file .env.staging -f compose.staging.yml up -d

# Verify services are running
docker compose --env-file .env.staging -f compose.staging.yml ps

# Expected output:
# NAME                    STATUS
# cryptoexchange-postgres Healthy
# cryptoexchange-redis    Healthy
# cryptoexchange-app      Running
# cryptoexchange-proxy    Starting (takes 1-2 min for HTTPS)
```

### 3.4 Monitor Startup

```bash
# Check API logs
docker compose --env-file .env.staging -f compose.staging.yml logs app

# Expected output:
# app-1  | Demo account API listening on http://localhost:3001

# Check database migration
docker compose --env-file .env.staging -f compose.staging.yml logs migrate

# Check proxy status
docker compose --env-file .env.staging -f compose.staging.yml logs proxy

# Wait for HTTPS certificate (2-3 minutes)
```

---

## 🌐 Step 4: Configure DNS (Optional)

### 4.1 Get Instance Public IP

```bash
# From AWS Console or:
aws ec2 describe-instances \
  --instance-ids i-0123456789abcdef0 \
  --query 'Reservations[0].Instances[0].PublicIpAddress'
```

### 4.2 Update DNS Records

**Provider:** Namecheap, GoDaddy, Route 53, etc.

**Record Type:** A (IPv4)
```
Domain: shopboostlabs.com
Type:   A
Value:  54.123.45.67  (your EC2 public IP)
TTL:    300 (5 minutes for testing)
```

### 4.3 Verify DNS Resolution

```bash
# Wait 5-10 minutes for DNS to propagate
nslookup shopboostlabs.com
# Should return: 54.123.45.67

# Or test with curl (from Windows or EC2)
curl -I https://shopboostlabs.com
# Should return: 200 OK with SSL certificate
```

---

## ✅ Step 5: Verify Deployment

### 5.1 Test API Endpoints

```bash
# Health check
curl -I http://54.123.45.67/api/ready

# Full health response
curl http://54.123.45.67/api/health

# Expected response:
# {
#   "status": "healthy",
#   "database": "connected",
#   "cache": "connected",
#   "uptime": 123.45
# }
```

### 5.2 Test HTTPS (After DNS Configured)

```bash
# If DNS is configured
curl -I https://shopboostlabs.com

# Should return 200 with valid certificate
# Certificate issuer: Let's Encrypt (auto-obtained by Caddy)
```

### 5.3 Test Registration Flow

```bash
# Create test account
curl -X POST http://54.123.45.67/api/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPass123!",
    "name": "Test User"
  }'

# Expected response:
# {"success": true, "userId": "..."}
```

### 5.4 Test Email Delivery

```bash
# Trigger verification email (after AWS SES sender verification)
# User should receive email within 1 second
```

---

## 🔒 Step 6: Security Hardening

### 6.1 SSH Key Management

```bash
# ✓ Already done: Only your SSH key can access
# Verify no password auth:
sudo grep "^PasswordAuthentication" /etc/ssh/sshd_config
# Should output: PasswordAuthentication no
```

### 6.2 Firewall Rules

```bash
# Security Group rules (in AWS Console):
# ✓ Already configured: SSH, HTTP, HTTPS only

# Optional: UFW on instance
sudo ufw enable
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

### 6.3 Secrets Management

```bash
# ✓ Done: .env.staging is chmod 600 (root only)
# ✓ Keep .env.staging out of git
# ✓ Use AWS Secrets Manager for production

# Verify .env.staging permissions:
ls -la .env.staging
# -rw------- (600)
```

### 6.4 Updates and Monitoring

```bash
# Set up automatic security updates
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades

# Monitor disk space
df -h

# Monitor Docker resource usage
docker stats
```

---

## 📊 Step 7: Monitoring & Logs

### 7.1 View Logs

```bash
# All services
docker compose --env-file .env.staging -f compose.staging.yml logs --tail 50 -f

# Specific service
docker compose --env-file .env.staging -f compose.staging.yml logs app -f

# With timestamps
docker compose --env-file .env.staging -f compose.staging.yml logs app -t
```

### 7.2 Health Check Endpoint

```bash
# Application health
curl http://54.123.45.67/api/health

# Database check
curl http://54.123.45.67/api/health/db

# Session rotation check
curl http://54.123.45.67/api/health/sessions \
  -H "X-Monitoring-Token: 94fc8e96b78a9961d925461013e81e2a"
```

### 7.3 Container Diagnostics

```bash
# List running containers
docker ps

# Inspect specific container
docker inspect cryptoexchange-app-1

# View container logs with errors
docker logs cryptoexchange-app-1 | grep -i error

# Shell into container for debugging
docker exec -it cryptoexchange-app-1 sh
```

---

## 🔄 Step 8: Maintenance

### 8.1 Restart Services

```bash
# Restart all services
docker compose --env-file .env.staging -f compose.staging.yml restart

# Restart specific service
docker compose --env-file .env.staging -f compose.staging.yml restart app

# Stop all services
docker compose --env-file .env.staging -f compose.staging.yml stop

# Start all services
docker compose --env-file .env.staging -f compose.staging.yml up -d
```

### 8.2 Update Application

```bash
# Pull latest code (if using git)
git pull origin main

# Rebuild images
docker compose --env-file .env.staging -f compose.staging.yml build

# Restart with new images
docker compose --env-file .env.staging -f compose.staging.yml up -d
```

### 8.3 Database Backup

```bash
# Backup to local file
docker exec cryptoexchange-postgres-1 pg_dump -U postgres exchange > backup.sql

# Download backup
scp -i nexa-staging.pem ubuntu@54.123.45.67:~/backup.sql .

# Restore backup
cat backup.sql | docker exec -i cryptoexchange-postgres-1 psql -U postgres
```

---

## ⚠️ AWS Free Tier Notes

**Eligibility:**
- t2.micro: 750 hours/month free (always-on = ~31 days)
- 30 GB EBS storage: Free
- 1 GB data transfer OUT: Free
- RDS: Not included (use PostgreSQL in Docker instead)

**After free tier:**
- t2.micro: ~$9/month
- Data transfer: ~$0.09/GB
- Elastic IP (if static): $3.50/month (optional)

**To stay free:**
- Use t2.micro instance
- Keep within storage limits
- Minimize data transfer
- Stop instance when not testing ($0 cost)

---

## 🐛 Troubleshooting

### Issue: Connection Refused

```bash
# Check if containers are running
docker ps

# Restart services
docker compose --env-file .env.staging -f compose.staging.yml restart

# Check logs
docker compose --env-file .env.staging -f compose.staging.yml logs
```

### Issue: Database Connection Error

```bash
# Check PostgreSQL container
docker logs cryptoexchange-postgres-1

# Verify DATABASE_URL in .env.staging
grep "DATABASE_URL" .env.staging

# Test database connection
docker exec cryptoexchange-postgres-1 psql -U postgres -d exchange -c "SELECT 1"
```

### Issue: HTTPS Certificate Not Issued

```bash
# Check Caddy logs
docker logs cryptoexchange-proxy-1

# Common causes:
# - DNS not configured yet (wait 5-10 min and retry)
# - Port 80 not accessible (check security group)
# - Domain not pointing to instance (verify DNS)

# Force certificate renewal
docker compose --env-file .env.staging -f compose.staging.yml restart proxy
```

### Issue: Out of Memory

```bash
# Check resource usage
docker stats

# Increase swap
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## ✅ Deployment Checklist

- [ ] EC2 instance created (t2.micro)
- [ ] SSH access verified
- [ ] Docker installed
- [ ] Repository cloned/copied
- [ ] `.env.staging` copied and secured (chmod 600)
- [ ] Services running and healthy
- [ ] API responding on port 3001
- [ ] HTTP health checks passing
- [ ] DNS configured (optional, can use IP)
- [ ] HTTPS working (after DNS setup)
- [ ] Registration flow tested
- [ ] Email delivery tested
- [ ] Logs monitored
- [ ] Security group configured
- [ ] Monitoring enabled

---

## 📞 Quick Reference

**Instance Details File:** `aws-deployment-details.txt` (save this!)

```
Instance ID: i-0123456789abcdef0
Public IP: 54.123.45.67
Private IP: 10.0.1.234
DNS Name: ec2-54-123-45-67.compute-1.amazonaws.com
Region: us-east-1a
Key Pair: nexa-staging.pem
Security Group: nexa-staging-sg
Domain: shopboostlabs.com (optional)
```

**Useful Commands (Run on EC2):**

```bash
# SSH connection (from Windows)
ssh -i nexa-staging.pem ubuntu@54.123.45.67

# Check status
docker compose --env-file .env.staging -f compose.staging.yml ps

# View logs
docker compose --env-file .env.staging -f compose.staging.yml logs app -f

# Test API
curl http://localhost:3001/api/ready

# Restart all
docker compose --env-file .env.staging -f compose.staging.yml restart
```

---

**Status:** Ready for EC2 deployment  
**Estimated Time:** 30-45 minutes  
**Next Step:** Follow Step 1 to create EC2 instance

Generated: Sept 4, 2026
