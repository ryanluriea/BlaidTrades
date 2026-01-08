# BlaidTrades AWS Infrastructure

This directory contains Terraform configurations for deploying BlaidTrades to AWS with enterprise-grade infrastructure.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AWS Cloud                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────┐     ┌─────────────────────────────────────────────────────┐ │
│  │   Route53  │────▶│              Application Load Balancer              │ │
│  │   (DNS)    │     │                   (HTTPS/443)                       │ │
│  └────────────┘     └──────────────────────┬──────────────────────────────┘ │
│                                            │                                 │
│  ┌─────────────────────────────────────────┼────────────────────────────┐   │
│  │                    VPC (10.0.0.0/16)    │                            │   │
│  │  ┌──────────────────────────────────────┼───────────────────────┐    │   │
│  │  │              Private Subnets         ▼                       │    │   │
│  │  │  ┌────────────────────┐   ┌────────────────────┐            │    │   │
│  │  │  │   ECS API Service  │   │  ECS Worker Service │           │    │   │
│  │  │  │   (2-10 tasks)     │   │   (2-10 tasks)      │           │    │   │
│  │  │  │   - Express.js     │   │   - Backtest workers│           │    │   │
│  │  │  │   - WebSocket      │   │   - Evolution       │           │    │   │
│  │  │  │   - Static files   │   │   - Autonomy        │           │    │   │
│  │  │  └─────────┬──────────┘   └──────────┬──────────┘           │    │   │
│  │  │            │                         │                       │    │   │
│  │  │            ▼                         ▼                       │    │   │
│  │  │  ┌────────────────────────────────────────────────────────┐ │    │   │
│  │  │  │                Aurora Serverless v2                    │ │    │   │
│  │  │  │            (PostgreSQL 15, 0.5-16 ACUs)                │ │    │   │
│  │  │  │         Writer + Reader (auto-scaling)                 │ │    │   │
│  │  │  └────────────────────────────────────────────────────────┘ │    │   │
│  │  │                                                              │    │   │
│  │  │  ┌────────────────────────────────────────────────────────┐ │    │   │
│  │  │  │              ElastiCache Redis 7                       │ │    │   │
│  │  │  │          (cache.r6g.large, 1-2 nodes)                  │ │    │   │
│  │  │  │         Job queues, caching, sessions                  │ │    │   │
│  │  │  └────────────────────────────────────────────────────────┘ │    │   │
│  │  └──────────────────────────────────────────────────────────────┘    │   │
│  │                                                                       │   │
│  │  ┌───────────────────────────────────────────────────────────────┐   │   │
│  │  │                     Public Subnets                             │   │   │
│  │  │              NAT Gateway │ ALB │ Bastion (optional)           │   │   │
│  │  └───────────────────────────────────────────────────────────────┘   │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────────┐ │
│  │   Secrets Manager  │  │    CloudWatch      │  │         ECR            │ │
│  │   (API keys)       │  │    (Logs/Metrics)  │  │   (Container images)   │ │
│  └────────────────────┘  └────────────────────┘  └────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Prerequisites

1. **AWS CLI** installed and configured with appropriate credentials
2. **Terraform** v1.5+ installed
3. **Docker** installed for building container images

## Quick Start

### 1. Initialize Terraform

```bash
cd infrastructure/aws
terraform init
```

### 2. Configure Variables

```bash
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values
```

### 3. Plan and Apply

```bash
# Preview changes
terraform plan

# Apply infrastructure
terraform apply
```

### 4. Configure Secrets

After infrastructure is deployed, update the secrets in AWS Secrets Manager:

```bash
aws secretsmanager update-secret \
  --secret-id blaidtrades/production/app-secrets \
  --secret-string '{
    "OPENAI_API_KEY": "your-key",
    "ANTHROPIC_API_KEY": "your-key",
    ...
  }'
```

### 5. Build and Push Docker Images

```bash
# Get ECR login
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account>.dkr.ecr.us-east-1.amazonaws.com

# Build and push API image
docker build -t blaidtrades .
docker tag blaidtrades:latest <account>.dkr.ecr.us-east-1.amazonaws.com/blaidtrades:latest
docker push <account>.dkr.ecr.us-east-1.amazonaws.com/blaidtrades:latest

# Build and push Worker image
docker build -f Dockerfile.worker -t blaidtrades-worker .
docker tag blaidtrades-worker:latest <account>.dkr.ecr.us-east-1.amazonaws.com/blaidtrades:worker-latest
docker push <account>.dkr.ecr.us-east-1.amazonaws.com/blaidtrades:worker-latest
```

### 6. Deploy to ECS

```bash
# Force new deployment
aws ecs update-service --cluster blaidtrades-cluster --service blaidtrades-api --force-new-deployment
aws ecs update-service --cluster blaidtrades-cluster --service blaidtrades-worker --force-new-deployment
```

## Database Migration

### From Replit PostgreSQL to Aurora

1. Export data from Replit:
```bash
pg_dump -h <replit-host> -U <user> -d <db> -F c -f backup.dump
```

2. Import to Aurora:
```bash
pg_restore -h <aurora-endpoint> -U <user> -d blaidtrades -F c backup.dump
```

## Cost Breakdown (Estimated)

| Service | Monthly Cost |
|---------|-------------|
| Aurora Serverless v2 (0.5-16 ACU) | $100-400 |
| ElastiCache r6g.large (1-2 nodes) | $95-190 |
| ECS Fargate (2 API + 2 Workers) | $200-400 |
| ALB + Data Transfer | $50-100 |
| NAT Gateway | $35-70 |
| Secrets Manager + CloudWatch | $20-50 |
| **Total** | **$500-1,210/month** |

*Costs scale with usage. Aurora scales automatically from 0.5 to 16 ACUs based on load.*

## Scaling Configuration

### API Service Auto-Scaling
- **Min:** 2 tasks
- **Max:** 10 tasks
- **CPU Target:** 70%
- **Memory Target:** 80%

### Worker Service Auto-Scaling
- **Min:** 2 tasks
- **Max:** 10 tasks
- **CPU Target:** 70%

## Security Features

- All traffic encrypted in transit (TLS)
- Aurora encryption at rest
- ElastiCache encryption (at-rest and in-transit)
- Private subnets for all compute resources
- Security groups with least-privilege access
- Secrets stored in AWS Secrets Manager
- Container images scanned on push

## Monitoring

CloudWatch dashboards and alarms are configured for:
- ECS task health and resource utilization
- Aurora connections and query performance
- ElastiCache hit rate and memory usage
- ALB request count and latency

## Maintenance

### Updating Application

```bash
# Build new image
docker build -t blaidtrades .
docker push <ecr-url>/blaidtrades:latest

# Force deployment
aws ecs update-service --cluster blaidtrades-cluster --service blaidtrades-api --force-new-deployment
```

### Database Backup

Aurora automatically backs up with 7-day retention. For manual backups:
```bash
aws rds create-db-cluster-snapshot \
  --db-cluster-identifier blaidtrades-aurora \
  --db-cluster-snapshot-identifier manual-backup-$(date +%Y%m%d)
```

## Troubleshooting

### ECS Tasks Not Starting
1. Check CloudWatch logs: `/ecs/blaidtrades/api` or `/ecs/blaidtrades/worker`
2. Verify security group rules allow database/Redis access
3. Check Secrets Manager permissions

### Database Connection Issues
1. Verify security group allows 5432 from ECS tasks
2. Check Aurora cluster status in RDS console
3. Validate DATABASE_URL format in task definition

### High Latency
1. Check Aurora ACU utilization (may need to increase max ACU)
2. Review ECS task CPU/memory utilization
3. Check ElastiCache metrics for cache misses
