/**
 * Google Drive Client
 * 
 * Provides authenticated access to Google Drive for backup/restore operations.
 * Supports two authentication modes:
 * 1. Replit Connector (development) - uses REPLIT_CONNECTORS_HOSTNAME
 * 2. User OAuth tokens (production) - uses stored user tokens from database
 */

import { google, drive_v3 } from 'googleapis';

let currentUserId: string | null = null;

export function setCurrentUserId(userId: string | null) {
  currentUserId = userId;
}

// Connection status cache - avoids repeated network calls
interface ConnectionCache {
  connected: boolean;
  timestamp: number;
}
const connectionCache = new Map<string, ConnectionCache>();
const CONNECTION_CACHE_TTL = 60000; // 60 seconds

export function getCachedConnectionStatus(userId: string): boolean | null {
  const cached = connectionCache.get(userId);
  if (cached && Date.now() - cached.timestamp < CONNECTION_CACHE_TTL) {
    return cached.connected;
  }
  return null;
}

export function setCachedConnectionStatus(userId: string, connected: boolean): void {
  connectionCache.set(userId, { connected, timestamp: Date.now() });
}

export function clearConnectionCache(userId: string): void {
  connectionCache.delete(userId);
}

async function fetchReplitConnectorToken(): Promise<string | null> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!hostname || !xReplitToken) {
    return null;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch(
      'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-drive',
      {
        headers: {
          'Accept': 'application/json',
          'X_REPLIT_TOKEN': xReplitToken
        },
        signal: controller.signal
      }
    );
    clearTimeout(timeoutId);
    
    const data = await response.json() as { items?: Array<{ settings?: { access_token?: string; expires_at?: string; oauth?: { credentials?: { access_token?: string } } } }> };
    const connectionSettings = data.items?.[0];

    const accessToken = connectionSettings?.settings?.access_token || connectionSettings?.settings?.oauth?.credentials?.access_token;
    return accessToken || null;
  } catch (error) {
    return null;
  }
}

async function fetchUserOAuthToken(userId: string): Promise<string | null> {
  try {
    const { getAccessTokenForUser } = await import('./google-drive-oauth');
    return await getAccessTokenForUser(userId);
  } catch (error) {
    console.warn('[GOOGLE_DRIVE] User OAuth token fetch failed:', error);
    return null;
  }
}

async function fetchAccessToken(): Promise<string> {
  if (currentUserId) {
    const userToken = await fetchUserOAuthToken(currentUserId);
    if (userToken) {
      return userToken;
    }
  }
  
  if (hasReplitConnectorConfigured()) {
    const replitToken = await fetchReplitConnectorToken();
    if (replitToken) {
      return replitToken;
    }
  }
  
  throw new Error('Google Drive not connected. Please connect your Google Drive account.');
}

export async function getGoogleDriveClient(): Promise<drive_v3.Drive> {
  const accessToken = await fetchAccessToken();

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token: accessToken
  });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

export async function getGoogleDriveClientForUser(userId: string): Promise<drive_v3.Drive> {
  const userToken = await fetchUserOAuthToken(userId);
  
  if (!userToken) {
    if (hasReplitConnectorConfigured()) {
      const replitToken = await fetchReplitConnectorToken();
      if (replitToken) {
        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({ access_token: replitToken });
        return google.drive({ version: 'v3', auth: oauth2Client });
      }
    }
    throw new Error('Google Drive not connected. Please connect your Google Drive account.');
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: userToken });
  return google.drive({ version: 'v3', auth: oauth2Client });
}

function hasReplitConnectorConfigured(): boolean {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY || process.env.WEB_REPL_RENEWAL;
  return !!(hostname && xReplitToken);
}

export async function isGoogleDriveConnected(): Promise<boolean> {
  if (!currentUserId && !hasReplitConnectorConfigured()) {
    return false;
  }
  
  try {
    await fetchAccessToken();
    return true;
  } catch {
    return false;
  }
}

export async function isGoogleDriveConnectedForUser(userId: string): Promise<boolean> {
  const startTime = Date.now();
  console.log(`[GOOGLE_DRIVE] isConnectedForUser: Checking for user ${userId.substring(0, 8)}...`);
  
  // Check cache first for instant response
  const cached = getCachedConnectionStatus(userId);
  if (cached !== null) {
    console.log(`[GOOGLE_DRIVE] isConnectedForUser: Cache hit=${cached} for user ${userId.substring(0, 8)} (${Date.now() - startTime}ms)`);
    return cached;
  }
  
  const userToken = await fetchUserOAuthToken(userId);
  if (userToken) {
    console.log(`[GOOGLE_DRIVE] isConnectedForUser: User OAuth token found for user ${userId.substring(0, 8)} (${Date.now() - startTime}ms)`);
    setCachedConnectionStatus(userId, true);
    return true;
  }
  
  console.log(`[GOOGLE_DRIVE] isConnectedForUser: No user token, checking Replit connector... (${Date.now() - startTime}ms)`);
  
  if (!hasReplitConnectorConfigured()) {
    console.log(`[GOOGLE_DRIVE] isConnectedForUser: No Replit connector configured, user ${userId.substring(0, 8)} not connected (${Date.now() - startTime}ms)`);
    setCachedConnectionStatus(userId, false);
    return false;
  }
  
  const replitToken = await fetchReplitConnectorToken();
  const connected = !!replitToken;
  console.log(`[GOOGLE_DRIVE] isConnectedForUser: Replit connector=${connected} for user ${userId.substring(0, 8)} (${Date.now() - startTime}ms)`);
  setCachedConnectionStatus(userId, connected);
  return connected;
}

const BACKUP_FOLDER_NAME = 'BlaidTrades_Backups';

export async function ensureBackupFolder(): Promise<string> {
  const drive = await getGoogleDriveClient();
  
  const response = await drive.files.list({
    q: `name='${BACKUP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
  });

  if (response.data.files && response.data.files.length > 0) {
    return response.data.files[0].id!;
  }

  const folderMetadata = {
    name: BACKUP_FOLDER_NAME,
    mimeType: 'application/vnd.google-apps.folder',
  };

  const folder = await drive.files.create({
    requestBody: folderMetadata,
    fields: 'id',
  });

  console.log(`[GOOGLE_DRIVE] Created backup folder: ${folder.data.id}`);
  return folder.data.id!;
}

export async function ensureBackupFolderForUser(userId: string): Promise<string> {
  try {
    const drive = await getGoogleDriveClientForUser(userId);
    
    const query = `name='${BACKUP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    console.log(`[GOOGLE_DRIVE] ensureBackupFolderForUser: Searching for folder with query: ${query}`);
    
    const response = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
    });

    if (response.data.files && response.data.files.length > 0) {
      console.log(`[GOOGLE_DRIVE] ensureBackupFolderForUser: Found existing folder ${response.data.files[0].id}`);
      return response.data.files[0].id!;
    }

    console.log(`[GOOGLE_DRIVE] ensureBackupFolderForUser: No folder found, creating new one`);
    const folderMetadata = {
      name: BACKUP_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    };

    const folder = await drive.files.create({
      requestBody: folderMetadata,
      fields: 'id',
    });

    console.log(`[GOOGLE_DRIVE] Created backup folder for user ${userId.substring(0, 8)}: ${folder.data.id}`);
    return folder.data.id!;
  } catch (error: any) {
    console.error(`[GOOGLE_DRIVE] ensureBackupFolderForUser: ERROR for user ${userId.substring(0, 8)}:`, error.message || error);
    throw error;
  }
}

export interface BackupMetadata {
  id: string;
  name: string;
  createdTime: string;
  size: string;
  description?: string;
}

export async function listBackups(): Promise<BackupMetadata[]> {
  const drive = await getGoogleDriveClient();
  const folderId = await ensureBackupFolder();

  const response = await drive.files.list({
    q: `'${folderId}' in parents and mimeType='application/json' and trashed=false`,
    fields: 'files(id, name, createdTime, size, description)',
    orderBy: 'createdTime desc',
    pageSize: 50,
  });

  return (response.data.files || []).map(file => ({
    id: file.id!,
    name: file.name!,
    createdTime: file.createdTime!,
    size: file.size || '0',
    description: file.description || undefined,
  }));
}

export async function listBackupsForUser(userId: string): Promise<BackupMetadata[]> {
  try {
    console.log(`[GOOGLE_DRIVE] listBackupsForUser: Starting for user ${userId.substring(0, 8)}...`);
    
    const drive = await getGoogleDriveClientForUser(userId);
    console.log(`[GOOGLE_DRIVE] listBackupsForUser: Got drive client`);
    
    const folderId = await ensureBackupFolderForUser(userId);
    console.log(`[GOOGLE_DRIVE] listBackupsForUser: Found folder ${folderId}`);

    const query = `'${folderId}' in parents and mimeType='application/json' and trashed=false`;
    console.log(`[GOOGLE_DRIVE] listBackupsForUser: Query = ${query}`);
    
    const response = await drive.files.list({
      q: query,
      fields: 'files(id, name, createdTime, size, description)',
      orderBy: 'createdTime desc',
      pageSize: 50,
    });

    const files = response.data.files || [];
    console.log(`[GOOGLE_DRIVE] listBackupsForUser: Found ${files.length} backup files`);
    
    if (files.length > 0) {
      console.log(`[GOOGLE_DRIVE] listBackupsForUser: First file = ${files[0].name}`);
    }

    return files.map(file => ({
      id: file.id!,
      name: file.name!,
      createdTime: file.createdTime!,
      size: file.size || '0',
      description: file.description || undefined,
    }));
  } catch (error: any) {
    console.error(`[GOOGLE_DRIVE] listBackupsForUser: ERROR for user ${userId.substring(0, 8)}:`, error.message || error);
    if (error.response?.data) {
      console.error(`[GOOGLE_DRIVE] listBackupsForUser: API Error Details:`, JSON.stringify(error.response.data));
    }
    throw error;
  }
}

export async function uploadBackup(
  filename: string,
  data: object,
  description?: string
): Promise<BackupMetadata> {
  const drive = await getGoogleDriveClient();
  const folderId = await ensureBackupFolder();

  const { Readable } = await import('stream');
  const jsonContent = JSON.stringify(data, null, 2);
  const contentLength = Buffer.byteLength(jsonContent, 'utf8');
  const stream = Readable.from(jsonContent);

  const fileMetadata = {
    name: filename,
    parents: [folderId],
    description: description || `BlaidTrades backup created at ${new Date().toISOString()}`,
  };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media: {
      mimeType: 'application/json',
      body: stream,
    },
    fields: 'id, name, createdTime, size, description',
  });

  console.log(`[GOOGLE_DRIVE] Uploaded backup: ${response.data.name} (${response.data.id})`);

  return {
    id: response.data.id!,
    name: response.data.name!,
    createdTime: response.data.createdTime!,
    size: response.data.size || String(contentLength),
    description: response.data.description || undefined,
  };
}

export async function uploadBackupForUser(
  userId: string,
  filename: string,
  data: object,
  description?: string
): Promise<BackupMetadata> {
  const drive = await getGoogleDriveClientForUser(userId);
  const folderId = await ensureBackupFolderForUser(userId);

  const { Readable } = await import('stream');
  const jsonContent = JSON.stringify(data, null, 2);
  const contentLength = Buffer.byteLength(jsonContent, 'utf8');
  const stream = Readable.from(jsonContent);

  const fileMetadata = {
    name: filename,
    parents: [folderId],
    description: description || `BlaidTrades backup created at ${new Date().toISOString()}`,
  };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media: {
      mimeType: 'application/json',
      body: stream,
    },
    fields: 'id, name, createdTime, size, description',
  });

  console.log(`[GOOGLE_DRIVE] Uploaded backup for user ${userId}: ${response.data.name}`);

  return {
    id: response.data.id!,
    name: response.data.name!,
    createdTime: response.data.createdTime!,
    size: response.data.size || String(contentLength),
    description: response.data.description || undefined,
  };
}

export async function downloadBackup(fileId: string): Promise<object> {
  const drive = await getGoogleDriveClient();

  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'text' }
  );

  return JSON.parse(response.data as string);
}

export async function downloadBackupForUser(userId: string, fileId: string): Promise<object> {
  const drive = await getGoogleDriveClientForUser(userId);

  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'text' }
  );

  return JSON.parse(response.data as string);
}

export async function deleteBackup(fileId: string): Promise<void> {
  const drive = await getGoogleDriveClient();
  await drive.files.delete({ fileId });
  console.log(`[GOOGLE_DRIVE] Deleted backup: ${fileId}`);
}

export async function deleteBackupForUser(userId: string, fileId: string): Promise<void> {
  const drive = await getGoogleDriveClientForUser(userId);
  await drive.files.delete({ fileId });
  console.log(`[GOOGLE_DRIVE] Deleted backup for user ${userId}: ${fileId}`);
}

export async function getBackupStatus(): Promise<{
  connected: boolean;
  folderExists: boolean;
  backupCount: number;
  latestBackup: BackupMetadata | null;
  totalSizeBytes: number;
}> {
  try {
    const connected = await isGoogleDriveConnected();
    if (!connected) {
      return {
        connected: false,
        folderExists: false,
        backupCount: 0,
        latestBackup: null,
        totalSizeBytes: 0,
      };
    }

    const backups = await listBackups();
    const totalSize = backups.reduce((sum, b) => sum + parseInt(b.size || '0', 10), 0);

    return {
      connected: true,
      folderExists: true,
      backupCount: backups.length,
      latestBackup: backups[0] || null,
      totalSizeBytes: totalSize,
    };
  } catch (error) {
    console.error('[GOOGLE_DRIVE] Status check failed:', error);
    return {
      connected: false,
      folderExists: false,
      backupCount: 0,
      latestBackup: null,
      totalSizeBytes: 0,
    };
  }
}

export async function getBackupStatusForUser(userId: string): Promise<{
  connected: boolean;
  folderExists: boolean;
  backupCount: number;
  latestBackup: BackupMetadata | null;
  totalSizeBytes: number;
}> {
  try {
    const connected = await isGoogleDriveConnectedForUser(userId);
    if (!connected) {
      return {
        connected: false,
        folderExists: false,
        backupCount: 0,
        latestBackup: null,
        totalSizeBytes: 0,
      };
    }

    const backups = await listBackupsForUser(userId);
    const totalSize = backups.reduce((sum, b) => sum + parseInt(b.size || '0', 10), 0);

    return {
      connected: true,
      folderExists: true,
      backupCount: backups.length,
      latestBackup: backups[0] || null,
      totalSizeBytes: totalSize,
    };
  } catch (error) {
    console.error('[GOOGLE_DRIVE] Status check for user failed:', error);
    return {
      connected: false,
      folderExists: false,
      backupCount: 0,
      latestBackup: null,
      totalSizeBytes: 0,
    };
  }
}
