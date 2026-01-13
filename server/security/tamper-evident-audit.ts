/**
 * Tamper-Evident Audit Log with Hash Chain
 * 
 * Provides cryptographic proof of audit log integrity using a blockchain-like
 * hash chain. Each entry contains a hash of the previous entry, making
 * tampering detectable.
 * 
 * Pattern used by:
 * - Financial institutions (regulatory compliance)
 * - Healthcare (HIPAA logs)
 * - Trading platforms (order audit trails)
 * 
 * Features:
 * - SHA-256 hash chain
 * - Periodic integrity verification
 * - Immutable append-only design
 * - Cryptographic proof of sequence
 */

import crypto from 'crypto';

interface AuditEntry {
  id: string;
  timestamp: string;
  eventType: string;
  action: string;
  actorId: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  previousHash: string;
  currentHash: string;
  sequence: number;
}

interface VerificationResult {
  valid: boolean;
  entriesChecked: number;
  brokenAt?: number;
  reason?: string;
}

const HASH_ALGORITHM = 'sha256';

class TamperEvidentAuditLog {
  private entries: AuditEntry[] = [];
  private sequence: number = 0;
  private genesisHash: string;
  
  constructor() {
    this.genesisHash = this.computeHash({
      genesis: true,
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    });
  }
  
  private computeHash(data: unknown): string {
    const serialized = JSON.stringify(data, Object.keys(data as object).sort());
    return crypto.createHash(HASH_ALGORITHM).update(serialized).digest('hex');
  }
  
  private getLastHash(): string {
    if (this.entries.length === 0) {
      return this.genesisHash;
    }
    return this.entries[this.entries.length - 1].currentHash;
  }
  
  append(
    eventType: string,
    action: string,
    actorId: string,
    options: {
      targetType?: string;
      targetId?: string;
      details?: Record<string, unknown>;
    } = {}
  ): AuditEntry {
    this.sequence++;
    
    const previousHash = this.getLastHash();
    const timestamp = new Date().toISOString();
    const id = crypto.randomUUID();
    
    // Create entry without hash first
    const entryData = {
      id,
      timestamp,
      eventType,
      action,
      actorId,
      targetType: options.targetType,
      targetId: options.targetId,
      details: options.details,
      previousHash,
      sequence: this.sequence,
    };
    
    // Compute hash of entry data
    const currentHash = this.computeHash(entryData);
    
    const entry: AuditEntry = {
      ...entryData,
      currentHash,
    };
    
    this.entries.push(entry);
    
    // Periodically verify integrity (every 100 entries)
    if (this.sequence % 100 === 0) {
      this.verifyIntegrityAsync();
    }
    
    return entry;
  }
  
  verify(startIndex: number = 0, endIndex?: number): VerificationResult {
    const end = endIndex ?? this.entries.length;
    
    if (this.entries.length === 0) {
      return { valid: true, entriesChecked: 0 };
    }
    
    for (let i = startIndex; i < end; i++) {
      const entry = this.entries[i];
      
      // Verify hash chain
      const expectedPrevHash = i === 0 ? this.genesisHash : this.entries[i - 1].currentHash;
      
      if (entry.previousHash !== expectedPrevHash) {
        return {
          valid: false,
          entriesChecked: i + 1,
          brokenAt: i,
          reason: `Hash chain broken at entry ${i}: expected previous hash ${expectedPrevHash.substring(0, 8)}..., got ${entry.previousHash.substring(0, 8)}...`,
        };
      }
      
      // Verify entry hash
      const { currentHash, ...entryData } = entry;
      const computedHash = this.computeHash(entryData);
      
      if (currentHash !== computedHash) {
        return {
          valid: false,
          entriesChecked: i + 1,
          brokenAt: i,
          reason: `Entry ${i} hash mismatch: possible tampering detected`,
        };
      }
    }
    
    return { valid: true, entriesChecked: end - startIndex };
  }
  
  private async verifyIntegrityAsync(): Promise<void> {
    // Run verification in next tick to not block
    setImmediate(() => {
      const result = this.verify();
      if (!result.valid) {
        console.error(`[AUDIT_INTEGRITY] TAMPERING DETECTED: ${result.reason}`);
        // In production, this would trigger an alert
      }
    });
  }
  
  getEntries(options: {
    limit?: number;
    offset?: number;
    eventType?: string;
    actorId?: string;
    startTime?: string;
    endTime?: string;
  } = {}): AuditEntry[] {
    let filtered = [...this.entries];
    
    if (options.eventType) {
      filtered = filtered.filter(e => e.eventType === options.eventType);
    }
    
    if (options.actorId) {
      filtered = filtered.filter(e => e.actorId === options.actorId);
    }
    
    if (options.startTime) {
      filtered = filtered.filter(e => e.timestamp >= options.startTime!);
    }
    
    if (options.endTime) {
      filtered = filtered.filter(e => e.timestamp <= options.endTime!);
    }
    
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;
    
    return filtered.slice(offset, offset + limit);
  }
  
  getProof(entryId: string): {
    entry: AuditEntry | null;
    chainProof: Array<{ sequence: number; hash: string }>;
    genesisHash: string;
  } {
    const entryIndex = this.entries.findIndex(e => e.id === entryId);
    
    if (entryIndex === -1) {
      return { entry: null, chainProof: [], genesisHash: this.genesisHash };
    }
    
    const entry = this.entries[entryIndex];
    
    // Build proof chain from genesis to this entry
    const chainProof: Array<{ sequence: number; hash: string }> = [];
    
    for (let i = 0; i <= entryIndex; i++) {
      chainProof.push({
        sequence: this.entries[i].sequence,
        hash: this.entries[i].currentHash,
      });
    }
    
    return { entry, chainProof, genesisHash: this.genesisHash };
  }
  
  getStats(): {
    totalEntries: number;
    latestSequence: number;
    latestHash: string;
    genesisHash: string;
    integrityStatus: 'VERIFIED' | 'PENDING' | 'COMPROMISED';
  } {
    const verifyResult = this.verify();
    
    return {
      totalEntries: this.entries.length,
      latestSequence: this.sequence,
      latestHash: this.getLastHash(),
      genesisHash: this.genesisHash,
      integrityStatus: verifyResult.valid ? 'VERIFIED' : 'COMPROMISED',
    };
  }
  
  exportForPersistence(): {
    entries: AuditEntry[];
    genesisHash: string;
    sequence: number;
  } {
    return {
      entries: this.entries,
      genesisHash: this.genesisHash,
      sequence: this.sequence,
    };
  }
  
  importFromPersistence(data: {
    entries: AuditEntry[];
    genesisHash: string;
    sequence: number;
  }): void {
    this.entries = data.entries;
    this.genesisHash = data.genesisHash;
    this.sequence = data.sequence;
    
    // Verify after import
    const result = this.verify();
    if (!result.valid) {
      console.error(`[AUDIT_INTEGRITY] Imported data failed verification: ${result.reason}`);
    }
  }
}

export const tamperEvidentAudit = new TamperEvidentAuditLog();

export function logSecureAudit(
  eventType: string,
  action: string,
  actorId: string,
  options: {
    targetType?: string;
    targetId?: string;
    details?: Record<string, unknown>;
  } = {}
): AuditEntry {
  return tamperEvidentAudit.append(eventType, action, actorId, options);
}
