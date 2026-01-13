/**
 * HMAC Webhook Signature Verification
 * 
 * Provides cryptographic verification for incoming webhooks to prevent:
 * - Replay attacks
 * - Request forgery
 * - Tampering
 * 
 * Pattern used by:
 * - Stripe
 * - GitHub
 * - Twilio
 * - Trading platforms (broker notifications)
 */

import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

interface WebhookConfig {
  secret: string;
  headerName: string;
  timestampHeader?: string;
  toleranceSeconds: number;
  algorithm: 'sha256' | 'sha512';
}

const WEBHOOK_CONFIGS: Record<string, WebhookConfig> = {
  'stripe': {
    secret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    headerName: 'stripe-signature',
    timestampHeader: 'stripe-signature',
    toleranceSeconds: 300,
    algorithm: 'sha256',
  },
  'discord': {
    secret: process.env.DISCORD_WEBHOOK_SECRET ?? '',
    headerName: 'x-signature-ed25519',
    toleranceSeconds: 300,
    algorithm: 'sha256',
  },
  'broker': {
    secret: process.env.BROKER_WEBHOOK_SECRET ?? '',
    headerName: 'x-broker-signature',
    timestampHeader: 'x-broker-timestamp',
    toleranceSeconds: 60, // Tighter for trading
    algorithm: 'sha256',
  },
  'internal': {
    secret: process.env.INTERNAL_WEBHOOK_SECRET ?? crypto.randomBytes(32).toString('hex'),
    headerName: 'x-internal-signature',
    timestampHeader: 'x-internal-timestamp',
    toleranceSeconds: 60,
    algorithm: 'sha256',
  },
};

export function generateSignature(
  payload: string,
  timestamp: number,
  secret: string,
  algorithm: 'sha256' | 'sha512' = 'sha256'
): string {
  const signaturePayload = `${timestamp}.${payload}`;
  return crypto
    .createHmac(algorithm, secret)
    .update(signaturePayload)
    .digest('hex');
}

export function verifySignature(
  payload: string,
  signature: string,
  timestamp: number,
  secret: string,
  toleranceSeconds: number,
  algorithm: 'sha256' | 'sha512' = 'sha256'
): { valid: boolean; reason?: string } {
  // Check timestamp tolerance
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.abs(now - timestamp);
  
  if (diff > toleranceSeconds) {
    return { valid: false, reason: 'Timestamp outside tolerance window (possible replay attack)' };
  }
  
  // Generate expected signature
  const expectedSignature = generateSignature(payload, timestamp, secret, algorithm);
  
  // Constant-time comparison to prevent timing attacks
  if (signature.length !== expectedSignature.length) {
    return { valid: false, reason: 'Invalid signature length' };
  }
  
  const signatureBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  
  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return { valid: false, reason: 'Signature mismatch' };
  }
  
  return { valid: true };
}

export function webhookVerificationMiddleware(provider: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const config = WEBHOOK_CONFIGS[provider];
    
    if (!config) {
      console.error(`[WEBHOOK] Unknown provider: ${provider}`);
      res.status(400).json({ error: 'Unknown webhook provider' });
      return;
    }
    
    if (!config.secret) {
      console.warn(`[WEBHOOK] No secret configured for ${provider}, skipping verification`);
      next();
      return;
    }
    
    const signature = req.headers[config.headerName.toLowerCase()] as string;
    
    if (!signature) {
      console.warn(`[WEBHOOK] Missing signature header for ${provider}`);
      res.status(401).json({ error: 'Missing signature' });
      return;
    }
    
    // Extract timestamp
    let timestamp: number;
    
    if (config.timestampHeader) {
      if (config.timestampHeader === config.headerName) {
        // Stripe-style: signature contains timestamp
        const parts = signature.split(',');
        const tPart = parts.find(p => p.startsWith('t='));
        if (tPart) {
          timestamp = parseInt(tPart.split('=')[1], 10);
        } else {
          timestamp = Math.floor(Date.now() / 1000);
        }
      } else {
        const tsHeader = req.headers[config.timestampHeader.toLowerCase()] as string;
        timestamp = tsHeader ? parseInt(tsHeader, 10) : Math.floor(Date.now() / 1000);
      }
    } else {
      timestamp = Math.floor(Date.now() / 1000);
    }
    
    // Get raw body for verification
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    
    // Extract actual signature (handle Stripe format: t=...,v1=...)
    let actualSignature = signature;
    if (signature.includes('v1=')) {
      const v1Part = signature.split(',').find(p => p.startsWith('v1='));
      if (v1Part) {
        actualSignature = v1Part.split('=')[1];
      }
    }
    
    const result = verifySignature(
      rawBody,
      actualSignature,
      timestamp,
      config.secret,
      config.toleranceSeconds,
      config.algorithm
    );
    
    if (!result.valid) {
      console.error(`[WEBHOOK] Verification failed for ${provider}: ${result.reason}`);
      res.status(401).json({ error: 'Invalid signature', reason: result.reason });
      return;
    }
    
    console.log(`[WEBHOOK] Verified ${provider} webhook`);
    next();
  };
}

export function generateWebhookHeaders(
  payload: string,
  provider: string = 'internal'
): Record<string, string> {
  const config = WEBHOOK_CONFIGS[provider];
  
  if (!config) {
    throw new Error(`Unknown webhook provider: ${provider}`);
  }
  
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = generateSignature(payload, timestamp, config.secret, config.algorithm);
  
  const headers: Record<string, string> = {
    [config.headerName]: signature,
  };
  
  if (config.timestampHeader && config.timestampHeader !== config.headerName) {
    headers[config.timestampHeader] = String(timestamp);
  }
  
  return headers;
}
