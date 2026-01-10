/**
 * Google Drive OAuth Handler
 * 
 * Provides production-ready OAuth 2.0 flow for Google Drive integration.
 * Stores user tokens in database for persistence across sessions.
 */

import { google } from 'googleapis';
import { db } from './db';
import { userGoogleDriveTokens } from '@shared/schema';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.appdata',
];

const pendingOAuthStates = new Map<string, { userId: string; expiresAt: number }>();

export function getRedirectUri(): string {
  if (process.env.PRODUCTION_URL) {
    return `${process.env.PRODUCTION_URL}/api/auth/google-drive/callback`;
  }
  if (process.env.REPLIT_DEPLOYMENT_URL) {
    return `https://${process.env.REPLIT_DEPLOYMENT_URL}/api/auth/google-drive/callback`;
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}/api/auth/google-drive/callback`;
  }
  if (process.env.REPL_SLUG) {
    return `https://${process.env.REPL_SLUG}.replit.app/api/auth/google-drive/callback`;
  }
  return 'http://localhost:5000/api/auth/google-drive/callback';
}

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set for Google Drive OAuth');
  }
  
  const redirectUri = getRedirectUri();
  console.log(`[GOOGLE_DRIVE_OAUTH] Using redirect URI: ${redirectUri}`);
  
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export async function getGoogleDriveAuthUrl(userId: string): Promise<string> {
  const oauth2Client = getOAuth2Client();
  
  const state = crypto.randomBytes(32).toString('hex');
  
  pendingOAuthStates.set(state, {
    userId,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  
  setTimeout(() => {
    pendingOAuthStates.delete(state);
  }, 10 * 60 * 1000);
  
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    state,
    prompt: 'consent',
  });
  
  console.log(`[GOOGLE_DRIVE_OAUTH] Generated auth URL for user ${userId}`);
  return authUrl;
}

export async function handleGoogleDriveCallback(
  code: string,
  state: string
): Promise<{ success: boolean; error?: string; userId?: string }> {
  const stateData = pendingOAuthStates.get(state);
  
  if (!stateData) {
    console.error('[GOOGLE_DRIVE_OAUTH] Invalid or expired state');
    return { success: false, error: 'Invalid or expired OAuth state' };
  }
  
  if (Date.now() > stateData.expiresAt) {
    pendingOAuthStates.delete(state);
    console.error('[GOOGLE_DRIVE_OAUTH] OAuth state expired');
    return { success: false, error: 'OAuth state expired' };
  }
  
  const { userId } = stateData;
  pendingOAuthStates.delete(state);
  
  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    
    if (!tokens.access_token || !tokens.refresh_token) {
      console.error('[GOOGLE_DRIVE_OAUTH] Missing tokens in response');
      return { success: false, error: 'Failed to get tokens from Google' };
    }
    
    const expiresAt = tokens.expiry_date 
      ? new Date(tokens.expiry_date)
      : new Date(Date.now() + 3600 * 1000);
    
    const existing = await db.select()
      .from(userGoogleDriveTokens)
      .where(eq(userGoogleDriveTokens.userId, userId))
      .limit(1);
    
    if (existing.length > 0) {
      await db.update(userGoogleDriveTokens)
        .set({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenType: tokens.token_type || 'Bearer',
          scope: tokens.scope,
          expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(userGoogleDriveTokens.userId, userId));
      
      console.log(`[GOOGLE_DRIVE_OAUTH] Updated tokens for user ${userId}`);
    } else {
      await db.insert(userGoogleDriveTokens).values({
        userId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenType: tokens.token_type || 'Bearer',
        scope: tokens.scope,
        expiresAt,
      });
      
      console.log(`[GOOGLE_DRIVE_OAUTH] Stored new tokens for user ${userId}`);
    }
    
    return { success: true, userId };
  } catch (error) {
    console.error('[GOOGLE_DRIVE_OAUTH] Token exchange failed:', error);
    return { success: false, error: String(error) };
  }
}

export async function getUserGoogleDriveStatus(userId: string): Promise<{
  connected: boolean;
  expiresAt?: string;
  needsReauth?: boolean;
}> {
  try {
    const tokens = await db.select()
      .from(userGoogleDriveTokens)
      .where(eq(userGoogleDriveTokens.userId, userId))
      .limit(1);
    
    if (tokens.length === 0) {
      return { connected: false };
    }
    
    const token = tokens[0];
    const now = new Date();
    const needsReauth = token.expiresAt < now;
    
    return {
      connected: true,
      expiresAt: token.expiresAt.toISOString(),
      needsReauth,
    };
  } catch (error) {
    console.error('[GOOGLE_DRIVE_OAUTH] Status check failed:', error);
    return { connected: false };
  }
}

export async function disconnectGoogleDrive(userId: string): Promise<void> {
  await db.delete(userGoogleDriveTokens)
    .where(eq(userGoogleDriveTokens.userId, userId));
  
  console.log(`[GOOGLE_DRIVE_OAUTH] Disconnected Google Drive for user ${userId}`);
}

export async function getAccessTokenForUser(userId: string): Promise<string | null> {
  try {
    const tokens = await db.select()
      .from(userGoogleDriveTokens)
      .where(eq(userGoogleDriveTokens.userId, userId))
      .limit(1);
    
    if (tokens.length === 0) {
      return null;
    }
    
    const token = tokens[0];
    const now = new Date();
    
    if (token.expiresAt > now) {
      return token.accessToken;
    }
    
    console.log(`[GOOGLE_DRIVE_OAUTH] Token expired for user ${userId}, refreshing...`);
    
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
      refresh_token: token.refreshToken,
    });
    
    const { credentials } = await oauth2Client.refreshAccessToken();
    
    if (!credentials.access_token) {
      console.error('[GOOGLE_DRIVE_OAUTH] Failed to refresh token');
      return null;
    }
    
    const newExpiresAt = credentials.expiry_date 
      ? new Date(credentials.expiry_date)
      : new Date(Date.now() + 3600 * 1000);
    
    await db.update(userGoogleDriveTokens)
      .set({
        accessToken: credentials.access_token,
        expiresAt: newExpiresAt,
        updatedAt: new Date(),
      })
      .where(eq(userGoogleDriveTokens.userId, userId));
    
    console.log(`[GOOGLE_DRIVE_OAUTH] Refreshed token for user ${userId}`);
    return credentials.access_token;
  } catch (error) {
    console.error('[GOOGLE_DRIVE_OAUTH] Failed to get access token:', error);
    return null;
  }
}

export async function hasCredentialsConfigured(): Promise<boolean> {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
