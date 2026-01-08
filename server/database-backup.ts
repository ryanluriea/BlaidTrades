/**
 * Database Backup Worker
 * 
 * INDUSTRY STANDARD: Automated database backups for disaster recovery.
 * - Scheduled pg_dump backups (default: every 6 hours)
 * - Manual backup trigger via API
 * - Backup metadata tracking
 * - Retention policy (keep last N backups)
 * 
 * Note: Google Drive integration requires OAuth setup via Replit connector
 */

import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import { logActivityEvent } from "./activity-logger";

const execAsync = promisify(exec);

export interface BackupMetadata {
  id: string;
  timestamp: Date;
  filename: string;
  sizeBytes: number;
  durationMs: number;
  status: "SUCCESS" | "FAILED";
  errorMessage?: string;
  uploadedToCloud?: boolean;
  cloudLocation?: string;
}

interface BackupConfig {
  enabled: boolean;
  intervalMs: number;           // How often to backup
  retentionCount: number;       // Keep last N backups
  backupDir: string;            // Local directory for backups
  cloudUploadEnabled: boolean;  // Enable cloud upload (requires OAuth)
}

const DEFAULT_CONFIG: BackupConfig = {
  enabled: true,
  intervalMs: 6 * 60 * 60 * 1000,  // 6 hours
  retentionCount: 10,               // Keep last 10 backups
  backupDir: "/tmp/db_backups",
  cloudUploadEnabled: false,        // Disabled by default
};

class DatabaseBackupService {
  private config: BackupConfig = DEFAULT_CONFIG;
  private backupHistory: BackupMetadata[] = [];
  private scheduledBackup: NodeJS.Timeout | null = null;
  private isRunning = false;
  
  /**
   * Start the backup scheduler
   */
  start(): void {
    if (this.isRunning) {
      console.log("[DB_BACKUP] Already running");
      return;
    }
    
    // Ensure backup directory exists
    if (!fs.existsSync(this.config.backupDir)) {
      fs.mkdirSync(this.config.backupDir, { recursive: true });
    }
    
    this.isRunning = true;
    
    // Schedule regular backups
    this.scheduledBackup = setInterval(async () => {
      if (this.config.enabled) {
        await this.createBackup("scheduled");
      }
    }, this.config.intervalMs);
    
    console.log(`[DB_BACKUP] Started with interval=${this.config.intervalMs}ms retention=${this.config.retentionCount}`);
    
    // Create initial backup on start
    this.createBackup("startup").catch(console.error);
  }
  
  /**
   * Stop the backup scheduler
   */
  stop(): void {
    if (this.scheduledBackup) {
      clearInterval(this.scheduledBackup);
      this.scheduledBackup = null;
    }
    this.isRunning = false;
    console.log("[DB_BACKUP] Stopped");
  }
  
  /**
   * Create a database backup
   */
  async createBackup(trigger: "scheduled" | "manual" | "startup"): Promise<BackupMetadata> {
    const startTime = Date.now();
    const timestamp = new Date();
    const id = crypto.randomUUID().slice(0, 8);
    const filename = `backup_${timestamp.toISOString().replace(/[:.]/g, "-")}_${id}.sql.gz`;
    const filepath = path.join(this.config.backupDir, filename);
    
    console.log(`[DB_BACKUP] Starting ${trigger} backup: ${filename}`);
    
    try {
      // Get database URL from environment
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new Error("DATABASE_URL not configured");
      }
      
      // Run pg_dump and compress with gzip
      // Using --no-owner and --no-acl for portability
      const { stderr } = await execAsync(
        `pg_dump "${databaseUrl}" --no-owner --no-acl | gzip > "${filepath}"`,
        { timeout: 600_000 }  // 10 minute timeout
      );
      
      if (stderr && !stderr.includes("WARNING")) {
        console.warn(`[DB_BACKUP] pg_dump warnings: ${stderr}`);
      }
      
      // Get file size
      const stats = fs.statSync(filepath);
      const durationMs = Date.now() - startTime;
      
      const metadata: BackupMetadata = {
        id,
        timestamp,
        filename,
        sizeBytes: stats.size,
        durationMs,
        status: "SUCCESS",
        uploadedToCloud: false,
      };
      
      this.backupHistory.push(metadata);
      
      // Log success
      await logActivityEvent({
        eventType: "INTEGRATION_PROOF",
        severity: "INFO",
        title: "Database Backup Completed",
        summary: `${trigger} backup: ${filename} (${this.formatSize(stats.size)}) in ${durationMs}ms`,
        payload: metadata,
      });
      
      console.log(`[DB_BACKUP] Completed: ${filename} size=${this.formatSize(stats.size)} duration=${durationMs}ms`);
      
      // Enforce retention policy
      await this.enforceRetention();
      
      return metadata;
      
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      const metadata: BackupMetadata = {
        id,
        timestamp,
        filename,
        sizeBytes: 0,
        durationMs,
        status: "FAILED",
        errorMessage,
      };
      
      this.backupHistory.push(metadata);
      
      await logActivityEvent({
        eventType: "INTEGRATION_ERROR",
        severity: "ERROR",
        title: "Database Backup Failed",
        summary: `${trigger} backup failed: ${errorMessage}`,
        payload: metadata,
      });
      
      console.error(`[DB_BACKUP] Failed: ${errorMessage}`);
      
      // Clean up partial file if exists
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
      
      return metadata;
    }
  }
  
  /**
   * Enforce backup retention policy
   */
  private async enforceRetention(): Promise<void> {
    const files = fs.readdirSync(this.config.backupDir)
      .filter(f => f.startsWith("backup_") && f.endsWith(".sql.gz"))
      .map(f => ({
        name: f,
        path: path.join(this.config.backupDir, f),
        mtime: fs.statSync(path.join(this.config.backupDir, f)).mtime,
      }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    
    // Delete old backups beyond retention count
    const toDelete = files.slice(this.config.retentionCount);
    for (const file of toDelete) {
      try {
        fs.unlinkSync(file.path);
        console.log(`[DB_BACKUP] Deleted old backup: ${file.name}`);
      } catch (err) {
        console.error(`[DB_BACKUP] Failed to delete ${file.name}:`, err);
      }
    }
    
    // Also trim history
    if (this.backupHistory.length > this.config.retentionCount * 2) {
      this.backupHistory = this.backupHistory.slice(-this.config.retentionCount * 2);
    }
  }
  
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
  }
  
  /**
   * Get backup history
   */
  getHistory(): BackupMetadata[] {
    return [...this.backupHistory];
  }
  
  /**
   * Get last successful backup
   */
  getLastSuccessful(): BackupMetadata | null {
    for (let i = this.backupHistory.length - 1; i >= 0; i--) {
      if (this.backupHistory[i].status === "SUCCESS") {
        return this.backupHistory[i];
      }
    }
    return null;
  }
  
  /**
   * List available backup files
   */
  listBackupFiles(): { filename: string; sizeBytes: number; timestamp: Date }[] {
    if (!fs.existsSync(this.config.backupDir)) {
      return [];
    }
    
    return fs.readdirSync(this.config.backupDir)
      .filter(f => f.startsWith("backup_") && f.endsWith(".sql.gz"))
      .map(f => {
        const filepath = path.join(this.config.backupDir, f);
        const stats = fs.statSync(filepath);
        return {
          filename: f,
          sizeBytes: stats.size,
          timestamp: stats.mtime,
        };
      })
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }
  
  /**
   * Update configuration
   */
  setConfig(config: Partial<BackupConfig>): void {
    this.config = { ...this.config, ...config };
    console.log(`[DB_BACKUP] Config updated: interval=${this.config.intervalMs}ms retention=${this.config.retentionCount}`);
    
    // Restart scheduler if interval changed
    if (config.intervalMs && this.isRunning) {
      this.stop();
      this.start();
    }
  }
  
  /**
   * Get current configuration
   */
  getConfig(): BackupConfig {
    return { ...this.config };
  }
}

export const databaseBackupService = new DatabaseBackupService();
