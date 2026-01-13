# API Reference

## Overview

BlaidTrades API v1 - Autonomous Trading Infrastructure Platform

Base URL: `https://your-domain.com/api`

## Authentication

All endpoints require authentication via session cookies. Login via `/api/auth/login`.

## Response Format

All responses follow a consistent format:

```json
{
  "success": true,
  "data": { ... },
  "error": null
}
```

Error responses:

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": { ... }
}
```

## Endpoints

### Health & Status

#### GET /api/health
Check API health status.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### GET /api/version
Get API version information.

**Response:**
```json
{
  "version": "1.0.0",
  "environment": "production"
}
```

---

### Authentication

#### POST /api/auth/login
Authenticate user and create session.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": { "id": "uuid", "email": "user@example.com" }
  }
}
```

#### POST /api/auth/logout
End user session.

#### GET /api/auth/me
Get current authenticated user.

---

### Bots

#### GET /api/bots-overview
Get comprehensive overview of all bots with enrichment data.

**Headers:**
- `x-cache`: HIT/MISS/STALE - Cache status
- `x-cache-age`: Cache age in seconds

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Bot Name",
      "stage": "PAPER",
      "accountId": "uuid",
      "botNow": { ... },
      "live_pnl": { ... },
      "matrix_aggregate": { ... }
    }
  ],
  "degraded": false,
  "degradedPhases": [],
  "snapshotId": "unique-id",
  "generatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Graceful Degradation:**
When secondary data fetches fail, the endpoint returns partial data with:
- `degraded: true`
- `degradedPhases: ["accounts", "trend", ...]`

#### GET /api/bots
Get list of user's bots (simpler than overview).

#### GET /api/bots/:id
Get single bot by ID.

#### POST /api/bots
Create a new bot.

#### PATCH /api/bots/:id
Update bot configuration.

#### DELETE /api/bots/:id
Delete a bot.

---

### Accounts

#### GET /api/accounts
Get user's trading accounts.

#### POST /api/accounts
Create a new trading account.

---

### Strategy Lab

#### GET /api/strategy-lab/status
Get Strategy Lab operational status.

#### GET /api/strategy-lab/candidates
Get strategy candidates by disposition.

---

### Backtesting

#### POST /api/bots/:id/backtest
Start a backtest for a bot.

#### GET /api/bots/:id/backtest/:sessionId
Get backtest results.

---

### System

#### GET /api/system/power
Get system power state.

#### POST /api/system/power
Toggle system power on/off.

---

## Rate Limiting

- Standard endpoints: 100 requests per 15 minutes
- Trading endpoints: 20 requests per minute
- Admin endpoints: 10 requests per minute

Rate limit headers:
- `X-RateLimit-Remaining`: Requests remaining in window
- `X-RateLimit-Reset`: Window reset time (Unix timestamp)

## Error Codes

| Code | Description |
|------|-------------|
| `VALIDATION_ERROR` | Request validation failed |
| `RATE_LIMIT_EXCEEDED` | Rate limit reached |
| `AUTHENTICATION_REQUIRED` | Not authenticated |
| `FORBIDDEN` | Not authorized for resource |
| `NOT_FOUND` | Resource not found |
| `INTERNAL_ERROR` | Server error |

## Versioning

API versioning is indicated in the response headers:
- `X-API-Version`: Current API version

Future breaking changes will be introduced with `/api/v2/` prefix.
