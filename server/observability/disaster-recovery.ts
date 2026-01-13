/**
 * Disaster Recovery Validation Dashboard
 * 
 * Tracks RTO/RPO compliance and backup validation status.
 * 
 * RTO (Recovery Time Objective): Max acceptable downtime
 * RPO (Recovery Point Objective): Max acceptable data loss (in time)
 * 
 * Features:
 * - Backup status tracking
 * - Last successful restore test
 * - RTO/RPO compliance calculation
 * - Alert on missed backup windows
 */

interface BackupRecord {
  id: string;
  type: 'database' | 'config' | 'audit_log' | 'strategy';
  timestamp: string;
  sizeBytes: number;
  duration: number;
  status: 'success' | 'failed';
  location: string;
  error?: string;
}

interface RestoreTest {
  id: string;
  backupId: string;
  timestamp: string;
  duration: number;
  status: 'success' | 'failed';
  dataIntegrityCheck: boolean;
  error?: string;
}

interface DRConfig {
  rtoMinutes: number;     // Target recovery time
  rpoMinutes: number;     // Target recovery point
  backupIntervalHours: number;
  restoreTestIntervalDays: number;
}

interface DRStatus {
  config: DRConfig;
  
  lastBackups: Record<string, BackupRecord | null>;
  lastRestoreTest: RestoreTest | null;
  
  compliance: {
    rpoCompliant: boolean;
    rtoEstimateMinutes: number;
    rtoCompliant: boolean;
    backupsInWindow: boolean;
    restoreTestCurrent: boolean;
  };
  
  health: 'COMPLIANT' | 'AT_RISK' | 'NON_COMPLIANT';
  alerts: string[];
}

const DEFAULT_CONFIG: DRConfig = {
  rtoMinutes: 60,           // 1 hour recovery target
  rpoMinutes: 30,           // 30 min max data loss
  backupIntervalHours: 6,   // Backup every 6 hours
  restoreTestIntervalDays: 7, // Test restore weekly
};

class DisasterRecoveryTracker {
  private backups: BackupRecord[] = [];
  private restoreTests: RestoreTest[] = [];
  private config: DRConfig = DEFAULT_CONFIG;
  
  setConfig(config: Partial<DRConfig>): void {
    this.config = { ...this.config, ...config };
  }
  
  recordBackup(backup: Omit<BackupRecord, 'id'>): BackupRecord {
    const record: BackupRecord = {
      ...backup,
      id: `backup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    };
    
    this.backups.push(record);
    
    // Keep last 100 backups per type
    const typeBackups = this.backups.filter(b => b.type === backup.type);
    if (typeBackups.length > 100) {
      const toRemove = typeBackups.slice(0, typeBackups.length - 100);
      this.backups = this.backups.filter(b => !toRemove.includes(b));
    }
    
    if (backup.status === 'success') {
      console.log(`[DR] Backup recorded: type=${backup.type} size=${Math.round(backup.sizeBytes / 1024)}KB duration=${backup.duration}ms`);
    } else {
      console.error(`[DR] Backup FAILED: type=${backup.type} error=${backup.error}`);
    }
    
    return record;
  }
  
  recordRestoreTest(test: Omit<RestoreTest, 'id'>): RestoreTest {
    const record: RestoreTest = {
      ...test,
      id: `restore_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    };
    
    this.restoreTests.push(record);
    
    // Keep last 50 restore tests
    if (this.restoreTests.length > 50) {
      this.restoreTests = this.restoreTests.slice(-50);
    }
    
    if (test.status === 'success') {
      console.log(`[DR] Restore test PASSED: duration=${test.duration}ms integrity=${test.dataIntegrityCheck}`);
    } else {
      console.error(`[DR] Restore test FAILED: error=${test.error}`);
    }
    
    return record;
  }
  
  getStatus(): DRStatus {
    const now = new Date();
    const alerts: string[] = [];
    
    // Get last backup per type
    const lastBackups: Record<string, BackupRecord | null> = {};
    const backupTypes: Array<BackupRecord['type']> = ['database', 'config', 'audit_log', 'strategy'];
    
    for (const type of backupTypes) {
      const typeBackups = this.backups
        .filter(b => b.type === type && b.status === 'success')
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      
      lastBackups[type] = typeBackups[0] ?? null;
    }
    
    // Get last restore test
    const successfulRestores = this.restoreTests
      .filter(t => t.status === 'success')
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    const lastRestoreTest = successfulRestores[0] ?? null;
    
    // Check RPO compliance (time since last database backup)
    const lastDbBackup = lastBackups['database'];
    let rpoCompliant = false;
    
    if (lastDbBackup) {
      const minutesSinceBackup = (now.getTime() - new Date(lastDbBackup.timestamp).getTime()) / (1000 * 60);
      rpoCompliant = minutesSinceBackup <= this.config.rpoMinutes;
      
      if (!rpoCompliant) {
        alerts.push(`RPO violation: ${Math.round(minutesSinceBackup)} minutes since last backup (target: ${this.config.rpoMinutes} min)`);
      }
    } else {
      alerts.push('No database backups recorded');
    }
    
    // Estimate RTO based on last restore test
    let rtoEstimateMinutes = 999; // Unknown
    let rtoCompliant = false;
    
    if (lastRestoreTest) {
      rtoEstimateMinutes = Math.ceil(lastRestoreTest.duration / (1000 * 60));
      rtoCompliant = rtoEstimateMinutes <= this.config.rtoMinutes;
      
      if (!rtoCompliant) {
        alerts.push(`RTO at risk: Last restore took ${rtoEstimateMinutes} min (target: ${this.config.rtoMinutes} min)`);
      }
    } else {
      alerts.push('No restore tests recorded - RTO unknown');
    }
    
    // Check backup window compliance
    const backupWindowMs = this.config.backupIntervalHours * 60 * 60 * 1000;
    let backupsInWindow = true;
    
    for (const type of backupTypes) {
      const backup = lastBackups[type];
      if (backup) {
        const timeSinceBackup = now.getTime() - new Date(backup.timestamp).getTime();
        if (timeSinceBackup > backupWindowMs * 1.5) { // 50% grace period
          backupsInWindow = false;
          alerts.push(`Missed backup window for ${type}: ${Math.round(timeSinceBackup / (1000 * 60 * 60))} hours ago`);
        }
      }
    }
    
    // Check restore test currency
    const restoreTestWindowMs = this.config.restoreTestIntervalDays * 24 * 60 * 60 * 1000;
    let restoreTestCurrent = false;
    
    if (lastRestoreTest) {
      const timeSinceTest = now.getTime() - new Date(lastRestoreTest.timestamp).getTime();
      restoreTestCurrent = timeSinceTest <= restoreTestWindowMs;
      
      if (!restoreTestCurrent) {
        alerts.push(`Restore test overdue: ${Math.round(timeSinceTest / (1000 * 60 * 60 * 24))} days ago (target: ${this.config.restoreTestIntervalDays} days)`);
      }
    }
    
    // Determine overall health
    let health: 'COMPLIANT' | 'AT_RISK' | 'NON_COMPLIANT' = 'COMPLIANT';
    
    if (!rpoCompliant || !rtoCompliant) {
      health = 'NON_COMPLIANT';
    } else if (!backupsInWindow || !restoreTestCurrent) {
      health = 'AT_RISK';
    }
    
    return {
      config: this.config,
      lastBackups,
      lastRestoreTest,
      compliance: {
        rpoCompliant,
        rtoEstimateMinutes,
        rtoCompliant,
        backupsInWindow,
        restoreTestCurrent,
      },
      health,
      alerts,
    };
  }
  
  logSummary(): void {
    const status = this.getStatus();
    
    console.log(
      `[DR] health=${status.health} rpo_ok=${status.compliance.rpoCompliant} rto_ok=${status.compliance.rtoCompliant} ` +
      `rto_est=${status.compliance.rtoEstimateMinutes}min alerts=${status.alerts.length}`
    );
    
    if (status.alerts.length > 0) {
      for (const alert of status.alerts) {
        console.warn(`[DR] ALERT: ${alert}`);
      }
    }
  }
}

export const drTracker = new DisasterRecoveryTracker();

let drLogInterval: NodeJS.Timeout | null = null;

export function startDRTracking(logIntervalMs: number = 300000): void { // Every 5 min
  if (drLogInterval) {
    clearInterval(drLogInterval);
  }
  
  drLogInterval = setInterval(() => drTracker.logSummary(), logIntervalMs);
  drLogInterval.unref();
  
  console.log('[DR] Disaster recovery tracking started');
}

export function stopDRTracking(): void {
  if (drLogInterval) {
    clearInterval(drLogInterval);
    drLogInterval = null;
  }
}
