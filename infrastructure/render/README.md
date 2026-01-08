# BlaidTrades Render Deployment Guide

Deploy BlaidTrades to Render for a production-ready, scalable trading platform.

## Prerequisites

1. **Render Account** - Sign up at [render.com](https://render.com)
2. **GitHub Repository** - Push this codebase to GitHub (or use Replit's GitHub sync)

## Estimated Costs

| Service | Plan | Monthly Cost |
|---------|------|--------------|
| Web Service (API) | Standard | $25-85 |
| Worker Service | Standard | $25-85 |
| PostgreSQL | Pro | $50-100 |
| Redis | Standard | $10-30 |
| **Total** | | **$110-300** |

## Deployment Steps

### Step 1: Connect GitHub to Render

1. Go to [dashboard.render.com](https://dashboard.render.com)
2. Click **"New"** → **"Blueprint"**
3. Connect your GitHub account
4. Select your BlaidTrades repository
5. Render will auto-detect the `render.yaml` file

### Step 2: Configure Environment Variables

After the blueprint deploys, you need to add your API keys:

1. Go to each service in Render Dashboard
2. Click **"Environment"** tab
3. Add these secrets (copy from your Replit Secrets):

**Required API Keys:**
```
OPENAI_API_KEY
ANTHROPIC_API_KEY
GROQ_API_KEY
DATABENTO_API_KEY
POLYGON_API_KEY
FINNHUB_API_KEY
FMP_API_KEY
FRED_API_KEY
```

**Optional API Keys:**
```
XAI_API_KEY
GOOGLE_GEMINI_API_KEY
PERPLEXITY_API_KEY
NEWS_API_KEY
MARKETAUX_API_KEY
UNUSUAL_WHALES_API_KEY
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
IRONBEAM_USERNAME_1
IRONBEAM_PASSWORD_1
IRONBEAM_API_KEY_1
TRADOVATE_USERNAME
TRADOVATE_PASSWORD
TRADOVATE_APP_ID
```

### Step 3: Run Database Migration

After PostgreSQL is provisioned:

1. Go to the **blaidtrades-api** service
2. Click **"Shell"** tab
3. Run: `npm run db:push`

### Step 4: Verify Deployment

1. Check the API health: `https://blaidtrades-api.onrender.com/api/health`
2. Access the dashboard and log in
3. Verify bots are loading and backtests can run

## Architecture on Render

```
┌─────────────────────────────────────────────────────┐
│                    Internet                          │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│              Render Load Balancer                    │
│              (SSL termination)                       │
└─────────────────────┬───────────────────────────────┘
                      │
         ┌────────────┴────────────┐
         │                         │
┌────────▼────────┐       ┌────────▼────────┐
│  blaidtrades-   │       │  blaidtrades-   │
│      api        │       │     worker      │
│  (Web Service)  │       │ (Background)    │
│  1-3 instances  │       │  1-3 instances  │
└────────┬────────┘       └────────┬────────┘
         │                         │
         └────────────┬────────────┘
                      │
         ┌────────────┴────────────┐
         │                         │
┌────────▼────────┐       ┌────────▼────────┐
│  PostgreSQL     │       │     Redis       │
│  (Pro Plan)     │       │   (Standard)    │
│  Managed DB     │       │  Cache/Queue    │
└─────────────────┘       └─────────────────┘
```

## Scaling

Render auto-scales based on:
- **CPU**: Scales up when CPU exceeds 70%
- **Memory**: Scales up when memory exceeds 80%

Manual scaling:
1. Go to service → **"Settings"**
2. Adjust **"Instance Count"** min/max

## Monitoring

Render provides built-in:
- **Logs**: Real-time log streaming
- **Metrics**: CPU, Memory, Request count
- **Alerts**: Configure in Dashboard → Notifications

## Troubleshooting

### Database Connection Issues
- Check `DATABASE_URL` is set correctly
- Verify PostgreSQL service is running
- Check connection pool limits (default: 20)

### Worker Not Processing Jobs
- Check Redis connection
- Verify `WORKER_MODE=true` is set
- Check worker logs for errors

### Slow Response Times
- Scale up instances
- Check database query performance
- Verify Redis is being used for caching

## Migration from Replit

1. Export your current database:
   ```bash
   pg_dump $DATABASE_URL > backup.sql
   ```

2. Import to Render PostgreSQL:
   ```bash
   psql $RENDER_DATABASE_URL < backup.sql
   ```

3. Update DNS to point to Render URL

## Support

- Render Docs: [render.com/docs](https://render.com/docs)
- Render Status: [status.render.com](https://status.render.com)
