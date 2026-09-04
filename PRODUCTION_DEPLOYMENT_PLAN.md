# Production Deployment - Complete Roadmap

**Goal:** Deploy Nexa Crypto Exchange to AWS EC2 Production  
**Timeline:** 2-3 hours  
**Cost:** ~$30-50/month (t3.large + EBS + data transfer)

---

## 📋 **Phase 1: Production Infrastructure Setup**

### 1.1 Create Production EC2 Instance

**Specs:**
- Instance Type: `t3.large` (2 vCPU, 8GB RAM)
- Region: `us-east-1` (same as staging for consistency)
- Storage: `100GB gp3` (for application + data growth)
- Key Pair: `nexa-production.pem` (new, separate from staging)
- Security Group: `nexa-production-sg`

**Security Group Rules:**
```
SSH:   Port 22   | Your IP only (NOT 0.0.0.0/0)
HTTP:  Port 80   | 0.0.0.0/0 (anywhere)
HTTPS: Port 443  | 0.0.0.0/0 (anywhere)
```

### 1.2 Create RDS Database (Optional but Recommended)

**Alternative:** Keep PostgreSQL in Docker (current approach)

**If using RDS:**
- Engine: PostgreSQL 15
- Instance: db.t3.micro
- Storage: 100GB gp3
- Multi-AZ: No (for staging) → Yes (for production)
- Backup: 30-day retention
- Encryption: AES-256

---

## 🔐 **Phase 2: Security Hardening**

### 2.1 SSL Certificates

```
Provider: Let's Encrypt (via Caddy - FREE)
Auto-renewal: Yes (handled by Caddy)
Domains: shopboostlabs.com, www.shopboostlabs.com
```

### 2.2 AWS IAM Roles

```
Role: nexa-production-app
Permissions:
  - SES:SendEmail (for email)
  - S3:GetObject (for backups, if used)
  - CloudWatch:PutMetricData (for monitoring)
  - KMS:Decrypt (for encrypted data)
```

### 2.3 Environment Secrets

```
Storage: AWS Secrets Manager (NOT in .env files)
Rotation: Every 90 days
Access: Only production app role
```

### 2.4 Database Security

```
Roles:
  - nexa_admin: Schema management only (migrations)
  - nexa_app: Runtime (SELECT, INSERT only)
  - nexa_readonly: Analytics (SELECT only)

Access: Restrict to app security group only
```

---

## 🔄 **Phase 3: Configuration Changes**

### 3.1 Production Environment Variables

**Key Differences from Staging:**

```env
# Application
NODE_ENV=production
LOG_LEVEL=info
DEBUG=false

# Database
POSTGRES_POOL_SIZE=20 (vs 5 in staging)
POSTGRES_POOL_IDLE_TIMEOUT=30000
DATABASE_REPLICAS=1

# Performance
CACHE_TTL=3600 (1 hour, vs 300 in staging)
SESSION_TIMEOUT=86400 (24 hours)
RATE_LIMIT_WINDOW=60
RATE_LIMIT_MAX_REQUESTS=100

# Monitoring
MONITORING_ENABLED=true
MONITORING_INTERVAL=30000
ALERT_EMAIL=ops@shopboostlabs.com
```

### 3.2 DNS Configuration

```
Primary Domain: shopboostlabs.com
Type: A Record
Value: <Production EC2 Public IP>
TTL: 3600 (1 hour, can lower to 300 for faster propagation)

Alternative: Use Route 53 (AWS DNS)
- Supports failover
- Health check integration
- Easier multi-region setup
```

### 3.3 Backup Strategy

```
Database Backups:
  - Frequency: Every 6 hours
  - Retention: 30 days
  - Location: S3 (encrypted)
  - Test restore: Weekly

Application Backups:
  - Docker images: ECR (Elastic Container Registry)
  - Configuration: Secrets Manager
  - Code: GitHub with tags
```

---

## 📊 **Phase 4: Monitoring & Observability**

### 4.1 CloudWatch Setup

```
Metrics:
  - API response time (p50, p95, p99)
  - Database query time
  - Error rate (4xx, 5xx)
  - Memory usage
  - Disk usage
  - Network I/O

Logs:
  - Application logs → CloudWatch Logs
  - Database logs → CloudWatch Logs
  - Retention: 30 days

Alarms:
  - CPU > 80% → SNS notification
  - Memory > 90% → SNS notification
  - Disk > 80% → SNS notification
  - Error rate > 1% → SNS notification
  - API latency > 1s → SNS notification
```

### 4.2 Application Health

```
Endpoint: /api/health
Response:
  {
    "status": "healthy",
    "database": "connected",
    "cache": "connected",
    "uptime": 123456,
    "version": "1.0.0"
  }

Cadence: Every 30 seconds
Alerting: Restart if unhealthy for 2+ minutes
```

### 4.3 Error Tracking

```
Tool: Sentry (free tier) or AWS X-Ray
Captures: Exceptions, stack traces, breadcrumbs
Alerts: Critical errors → Slack/Email
Retention: 90 days
```

---

## 🚀 **Phase 5: Deployment Pipeline**

### 5.1 Build & Deploy Process

```
1. Push code to main branch
   ↓
2. GitHub Actions CI/CD
   ├─ Run tests
   ├─ Lint code
   ├─ Build Docker image
   ├─ Push to ECR
   └─ Notify on completion
   ↓
3. Manual approval (production only)
   ↓
4. Deploy to production EC2
   ├─ Pull latest image
   ├─ Stop old containers
   ├─ Start new containers
   ├─ Run migrations
   └─ Health check
   ↓
5. Rollback if failed (automatic)
```

### 5.2 Zero-Downtime Deployment

```
Strategy: Blue-Green
1. Run new version on secondary instance
2. Run smoke tests
3. Switch load balancer to new version
4. Keep old version running 5 minutes
5. Rollback if any issues

Tools:
  - Application Load Balancer (ALB)
  - Or: Caddy reverse proxy with multiple upstreams
```

---

## 💾 **Phase 6: Data Management**

### 6.1 Database Migration

```
From Staging:
  1. Export schema: pg_dump -s exchange > schema.sql
  2. Export data: pg_dump exchange > data.sql
  3. Verify data integrity
  4. Import to production database
  5. Run migrations: npm run migrate

Validation:
  - Row counts match
  - Constraints verified
  - Indexes created
  - No orphaned records
```

### 6.2 User Data Migration

```
If users exist in staging:
  1. Export user data
  2. Hash any sensitive fields
  3. Import to production
  4. Send password reset emails
  5. Notify users of new URL
```

---

## ✅ **Phase 7: Pre-Launch Checklist**

### Security
- [ ] All credentials in AWS Secrets Manager
- [ ] SSH key secured and backed up
- [ ] Security groups restrict unnecessary ports
- [ ] SSL certificate installed and auto-renewal working
- [ ] Database encryption enabled
- [ ] Backups automated and tested

### Performance
- [ ] Load testing completed (100+ concurrent users)
- [ ] Database queries optimized
- [ ] Caching strategy implemented
- [ ] CDN configured (if needed)
- [ ] Connection pooling tuned

### Reliability
- [ ] Health checks passing
- [ ] Monitoring alerts configured
- [ ] Error tracking active
- [ ] Rollback procedure tested
- [ ] Disaster recovery plan documented

### Compliance
- [ ] Privacy policy updated
- [ ] Terms of service updated
- [ ] GDPR compliance verified
- [ ] Data retention policy in place
- [ ] Audit logging enabled

### Operations
- [ ] On-call runbook created
- [ ] Incident response procedure documented
- [ ] Team trained on production procedures
- [ ] Escalation contacts defined
- [ ] Post-launch review scheduled

---

## 📈 **Phase 8: Launch & Monitoring**

### Launch Day Timeline

```
T-24h: Final testing, alerts enabled
T-1h:  Final backup, team briefing
T-0:   DNS switch (traffic flows to production)
T+5m:  Verify traffic received
T+15m: Monitor error rates
T+1h:  Full system health check
T+24h: Post-launch review
```

### Monitoring During Launch

```
Watch these metrics:
  - API response time (should be < 200ms)
  - Error rate (should be 0-0.1%)
  - Database connections (should be < 10)
  - Memory usage (should be < 70%)
  - Disk I/O (should be < 50%)
```

---

## 💰 **Cost Estimation**

### Monthly Costs

| Component | Type | Size | Cost |
|-----------|------|------|------|
| EC2 Instance | t3.large | 2vCPU, 8GB RAM | $20/month |
| EBS Storage | gp3 | 100GB | $10/month |
| Data Transfer | Outbound | ~5GB/month | $0.45/month |
| AWS SES | Email | 50K emails | $1/month |
| CloudWatch | Monitoring | Logs + Metrics | $2/month |
| Backups | S3 | 30GB retention | $0.70/month |
| **Total** | | | **~$34/month** |

### Scaling Costs

```
If traffic increases:
  t3.xlarge (4 vCPU, 16GB): +$40/month
  RDS Multi-AZ: +$50/month
  ElastiCache Redis: +$15/month
  ALB: +$15/month
  
Maximum estimated: $150/month for high-traffic deployment
```

---

## 📚 **Implementation Steps**

### Step 1: Create Production EC2
```bash
# Use same process as staging, but:
- Name: nexa-production
- Type: t3.large
- Key: nexa-production.pem
- Security Group: nexa-production-sg
- Restrict SSH to your IP
```

### Step 2: Copy Staging Configuration
```bash
# Copy .env.staging → .env.production
# Update:
- STAGING_DOMAIN → Production domain
- Database passwords (new, strong)
- Log levels (info instead of debug)
- Cache TTL (higher)
- Monitoring enabled
```

### Step 3: Deploy
```bash
# SSH to production instance
ssh -i nexa-production.pem ubuntu@<prod-ip>

# Clone repository or copy files
git clone <repo> || scp -r * <prod-ip>:~/crypto-exchange/

# Build and start
cd ~/crypto-exchange
docker compose --env-file .env.production -f compose.staging.yml up -d

# Verify
curl http://localhost:3001/api/ready
```

### Step 4: Configure DNS
```bash
# Update DNS A record
shopboostlabs.com A <prod-ip>

# Wait 5-10 minutes for propagation
nslookup shopboostlabs.com
```

### Step 5: Enable HTTPS
```bash
# Caddy auto-obtains Let's Encrypt certificate
# Wait 2-3 minutes for certificate issuance
curl -I https://shopboostlabs.com
# Should return 200 with SSL certificate
```

---

## 🎯 **Success Criteria**

✅ All services running and healthy  
✅ API responding on production domain  
✅ HTTPS working with valid certificate  
✅ Database connected and migrated  
✅ Email sending working  
✅ Monitoring and alerts active  
✅ Backups automated  
✅ Performance acceptable (< 200ms response time)  
✅ Error rate < 0.1%  
✅ Security hardened (no exposed secrets)  

---

## ⚠️ **Rollback Plan**

If production has critical issues:

```
1. Identify issue within 15 minutes
2. Switch DNS back to staging (30 seconds)
3. Notify users of temporary redirect
4. Investigate root cause
5. Fix and test on staging
6. Redeploy to production
7. Restore DNS to production
8. Post-mortem review
```

---

**Ready to start production deployment?** Let's begin! 🚀

Generated: September 4, 2026 | Nexa Crypto Exchange Production Plan
