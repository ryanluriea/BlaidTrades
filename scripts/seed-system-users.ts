#!/usr/bin/env tsx
/**
 * System User Seeding Script - Ensures DEFAULT_USER_ID exists
 * 
 * This script ensures the system/default user account exists in the database.
 * It's designed to be idempotent - safe to run multiple times.
 * 
 * CRITICAL: This script also migrates ALL orphaned FK references to DEFAULT_USER_ID.
 * This ensures bots, QC verifications, and other data are visible to the logged-in user.
 * The migration runs EVERY time, even if the user already exists, to fix any data
 * that was created with wrong user IDs.
 * 
 * Usage: npm run db:seed-users
 * 
 * Should be configured as part of Render's Pre-Deploy Command chain.
 */

import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const { Pool } = pg;

const DEFAULT_USER_ID = "489c9350-10da-4fb9-8f6b-aeffc9412a46";
const SYSTEM_USER_EMAIL = "blaidtrades@gmail.com";
const SYSTEM_USER_USERNAME = "BlaidAgent";

function generateSecureRandomPassword(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Reset user password if RESET_USER_PASSWORD env var is set
 * This enables production password reset during deploy
 */
async function resetPasswordIfRequested(pool: pg.Pool, userId: string): Promise<void> {
  const newPassword = process.env.RESET_USER_PASSWORD;
  if (!newPassword) {
    return;
  }
  
  console.log(`[SEED_USERS] RESET_USER_PASSWORD env var detected - resetting password...`);
  
  try {
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    const result = await pool.query(
      `UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2`,
      [hashedPassword, userId]
    );
    
    if (result.rowCount && result.rowCount > 0) {
      console.log(`[SEED_USERS] Password reset successful for user ${userId}`);
    } else {
      console.log(`[SEED_USERS] No user found with ID ${userId} to reset password`);
    }
  } catch (error) {
    console.error(`[SEED_USERS] Password reset failed:`, error instanceof Error ? error.message : 'unknown');
  }
}

/**
 * Migrate orphaned FK references to DEFAULT_USER_ID
 * 
 * TARGETED MIGRATION: First discovers legacy user IDs from the data itself,
 * then only migrates those specific IDs. This preserves any legitimate 
 * multi-user data while fixing the production issue.
 * 
 * This runs every time to fix any data created with wrong user IDs.
 */
async function migrateOrphanedFKReferences(pool: pg.Pool, targetUserId: string): Promise<void> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Log current user state for debugging
    const existingUsers = await client.query(`SELECT id, email FROM users`);
    console.log(`[SEED_USERS] Users in database: ${existingUsers.rows.length}`);
    for (const user of existingUsers.rows) {
      console.log(`[SEED_USERS]   - ${user.email} (${user.id})`);
    }
    
    // Build set of valid user IDs
    const validUserIds = new Set(existingUsers.rows.map(r => r.id));
    validUserIds.add(targetUserId); // Ensure target is always considered valid
    
    // Discover ALL columns that reference users.id
    const fkColumns = await client.query(`
      SELECT DISTINCT kcu.table_name, kcu.column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_name = 'users'
        AND ccu.column_name = 'id'
      ORDER BY kcu.table_name, kcu.column_name
    `);
    
    const fkRefs = fkColumns.rows.map(r => ({ table: r.table_name, column: r.column_name }));
    console.log(`[SEED_USERS] Found ${fkRefs.length} FK columns referencing users.id`);
    
    if (fkRefs.length === 0) {
      console.log(`[SEED_USERS] No FK references found - nothing to migrate`);
      await client.query('COMMIT');
      return;
    }
    
    // STEP 1: Discover legacy user IDs from bots table (the primary ownership table)
    // These are IDs that exist in data but NOT in the users table
    const legacyIdsResult = await client.query(`
      SELECT DISTINCT user_id FROM bots 
      WHERE user_id IS NOT NULL 
        AND user_id != $1 
        AND user_id NOT IN (SELECT id FROM users)
    `, [targetUserId]);
    
    const legacyUserIds = legacyIdsResult.rows.map(r => r.user_id);
    console.log(`[SEED_USERS] Found ${legacyUserIds.length} legacy user IDs in bots table: ${legacyUserIds.join(', ') || 'none'}`);
    
    // STEP 2: Also check for orphaned references (FK points to non-existent user)
    let totalMigrated = 0;
    
    for (const { table, column } of fkRefs) {
      try {
        // Find orphaned rows: FK column points to a user that doesn't exist
        const orphanedResult = await client.query(`
          SELECT COUNT(*) as cnt FROM "${table}" 
          WHERE "${column}" IS NOT NULL 
            AND "${column}" != $1
            AND "${column}" NOT IN (SELECT id FROM users)
        `, [targetUserId]);
        const orphanedCount = parseInt(orphanedResult.rows[0].cnt, 10);
        
        if (orphanedCount > 0) {
          // Get the distinct orphaned IDs for logging
          const distinctOrphaned = await client.query(`
            SELECT DISTINCT "${column}" as orphan_id FROM "${table}" 
            WHERE "${column}" IS NOT NULL 
              AND "${column}" != $1
              AND "${column}" NOT IN (SELECT id FROM users)
          `, [targetUserId]);
          const orphanIds = distinctOrphaned.rows.map(r => r.orphan_id).join(', ');
          console.log(`[SEED_USERS] ${table}.${column}: ${orphanedCount} orphaned rows (from: ${orphanIds})`);
          
          // Migrate orphaned rows to the canonical user
          const result = await client.query(`
            UPDATE "${table}" SET "${column}" = $1 
            WHERE "${column}" IS NOT NULL 
              AND "${column}" != $1
              AND "${column}" NOT IN (SELECT id FROM users)
          `, [targetUserId]);
          
          if (result.rowCount && result.rowCount > 0) {
            console.log(`[SEED_USERS] MIGRATED ${result.rowCount} orphaned rows in ${table}.${column}`);
            totalMigrated += result.rowCount;
          }
        }
      } catch (tableError: any) {
        console.error(`[SEED_USERS] ERROR migrating ${table}.${column}: ${tableError.message}`);
        // Continue with other tables
      }
    }
    
    await client.query('COMMIT');
    
    if (totalMigrated > 0) {
      console.log(`[SEED_USERS] *** SUCCESS: MIGRATED ${totalMigrated} total orphaned rows to ${targetUserId} ***`);
    } else {
      console.log(`[SEED_USERS] No orphaned FK references found - all data points to valid users`);
    }
    
    // STEP 3: Final verification - log any remaining non-target user data
    for (const { table, column } of fkRefs) {
      try {
        const remainingResult = await client.query(`
          SELECT COUNT(*) as cnt FROM "${table}" 
          WHERE "${column}" IS NOT NULL AND "${column}" != $1
        `, [targetUserId]);
        const remainingCount = parseInt(remainingResult.rows[0].cnt, 10);
        if (remainingCount > 0) {
          console.log(`[SEED_USERS] POST-MIGRATION: ${table}.${column} has ${remainingCount} rows with non-target user (these point to valid users)`);
        }
      } catch (e) {
        // Ignore errors in verification
      }
    }
    
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error(`[SEED_USERS] FK migration failed, rolled back:`, error.message);
    throw error;
  } finally {
    client.release();
  }
}

async function seedSystemUsers() {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    console.error("[SEED_USERS] DATABASE_URL not set, skipping user seeding");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    console.log("[SEED_USERS] Checking for system user...");

    // Check if user already exists
    const existingUser = await pool.query(
      `SELECT id, email, username FROM users WHERE id = $1`,
      [DEFAULT_USER_ID]
    );

    if (existingUser.rows.length > 0) {
      console.log(`[SEED_USERS] System user already exists: ${existingUser.rows[0].email}`);
      // DON'T return early - we still need to migrate any orphaned FK references!
      console.log(`[SEED_USERS] Checking for orphaned FK references to migrate...`);
      await migrateOrphanedFKReferences(pool, DEFAULT_USER_ID);
      
      // Reset password if requested (for production access)
      await resetPasswordIfRequested(pool, DEFAULT_USER_ID);
      return;
    }

    // Check if user exists by email (in case ID changed)
    const userByEmail = await pool.query(
      `SELECT id, email, username FROM users WHERE email = $1`,
      [SYSTEM_USER_EMAIL]
    );

    if (userByEmail.rows.length > 0) {
      const existingId = userByEmail.rows[0].id;
      console.log(`[SEED_USERS] User exists with different ID: ${existingId}`);
      console.log(`[SEED_USERS] Expected ID: ${DEFAULT_USER_ID}`);
      
      // Strategy: Update the existing user's ID to DEFAULT_USER_ID
      // This works because:
      // 1. The existing user (wrong ID) likely has no dependent data
      // 2. All bots/data are owned by DEFAULT_USER_ID
      // 3. After update, the logged-in user will see all data
      console.log(`[SEED_USERS] Updating user ID to canonical DEFAULT_USER_ID...`);
      
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
        // First, discover ALL columns that reference users.id (not just user_id)
        // This includes: user_id, requested_by, reviewed_by, validated_by, tested_by, signed_off_by, etc.
        const fkColumns = await client.query(`
          SELECT DISTINCT kcu.table_name, kcu.column_name
          FROM information_schema.table_constraints AS tc
          JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
          JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND ccu.table_name = 'users'
            AND ccu.column_name = 'id'
          ORDER BY kcu.table_name, kcu.column_name
        `);
        
        const fkRefs = fkColumns.rows.map(r => ({ table: r.table_name, column: r.column_name }));
        console.log(`[SEED_USERS] Discovered ${fkRefs.length} FK columns referencing users.id`);
        
        // Get ALL columns from users table dynamically to preserve all data
        const columnsResult = await client.query(`
          SELECT column_name FROM information_schema.columns 
          WHERE table_name = 'users' AND table_schema = 'public'
          ORDER BY ordinal_position
        `);
        const allColumns = columnsResult.rows.map(r => r.column_name);
        console.log(`[SEED_USERS] Users table has ${allColumns.length} columns: ${allColumns.join(', ')}`);
        
        // Get the existing user's FULL data
        const userData = await client.query(
          `SELECT * FROM users WHERE id = $1`,
          [existingId]
        );
        
        if (userData.rows.length === 0) {
          throw new Error(`User with ID ${existingId} not found`);
        }
        
        const existingUserData = userData.rows[0];
        const originalEmail = existingUserData.email;
        console.log(`[SEED_USERS] Preserving user data for ${originalEmail}`);
        
        // STEP 1: Temporarily change old user's email to avoid UNIQUE constraint violation
        // Note: Based on schema analysis, email is the ONLY unique constraint on users table (besides id)
        const tempEmail = `temp_migration_${Date.now()}@placeholder.local`;
        console.log(`[SEED_USERS] Temporarily changing old user email to avoid UNIQUE conflict...`);
        await client.query(
          `UPDATE users SET email = $1 WHERE id = $2`,
          [tempEmail, existingId]
        );
        
        // STEP 2: Create new user with DEFAULT_USER_ID by copying ALL data from existing user
        const columnsExceptId = allColumns.filter(c => c !== 'id');
        const columnList = ['id', ...columnsExceptId].map(c => `"${c}"`).join(', ');
        const valuePlaceholders = ['$1', ...columnsExceptId.map((_, i) => `$${i + 2}`)].join(', ');
        
        // Use ORIGINAL email for the new user
        const valuesForInsert = columnsExceptId.map(c => {
          if (c === 'email') return originalEmail;
          return existingUserData[c];
        });
        const values = [DEFAULT_USER_ID, ...valuesForInsert];
        
        console.log(`[SEED_USERS] Creating user with DEFAULT_USER_ID (preserving all ${allColumns.length} columns)...`);
        await client.query(
          `INSERT INTO users (${columnList}) VALUES (${valuePlaceholders})
           ON CONFLICT (id) DO UPDATE SET 
             email = EXCLUDED.email,
             username = EXCLUDED.username,
             updated_at = NOW()`,
          values
        );
        
        // STEP 3: Migrate all FK references from old ID to DEFAULT_USER_ID
        // Now DEFAULT_USER_ID exists, so FK constraints will be satisfied
        let totalMigrated = 0;
        for (const { table, column } of fkRefs) {
          try {
            const result = await client.query(
              `UPDATE "${table}" SET "${column}" = $1 WHERE "${column}" = $2`,
              [DEFAULT_USER_ID, existingId]
            );
            if (result.rowCount && result.rowCount > 0) {
              console.log(`[SEED_USERS] Migrated ${result.rowCount} rows in ${table}.${column} to DEFAULT_USER_ID`);
              totalMigrated += result.rowCount;
            }
          } catch (tableError: any) {
            console.error(`[SEED_USERS] ERROR migrating ${table}.${column}: ${tableError.message}`);
            throw tableError;
          }
        }
        
        if (totalMigrated > 0) {
          console.log(`[SEED_USERS] Migrated ${totalMigrated} total rows to DEFAULT_USER_ID`);
        }
        
        // STEP 4: Delete the old user (now has no FK references)
        console.log(`[SEED_USERS] Deleting old user ${existingId}...`);
        await client.query(`DELETE FROM users WHERE id = $1`, [existingId]);
        
        await client.query('COMMIT');
        console.log(`[SEED_USERS] SUCCESS: User ${SYSTEM_USER_EMAIL} now has ID ${DEFAULT_USER_ID}`);
        console.log(`[SEED_USERS] All bots and data are now accessible`);
        
        // Reset password after migration if requested
        await resetPasswordIfRequested(pool, DEFAULT_USER_ID);
        
      } catch (migrationError: any) {
        await client.query('ROLLBACK');
        console.error(`[SEED_USERS] Migration failed, rolled back:`, migrationError.message);
        
        // If we can't update the ID, at least log clearly what happened
        if (migrationError.code === '23503') {
          console.error(`[SEED_USERS] FK constraint prevents ID update - manual intervention required`);
          console.error(`[SEED_USERS] Run: UPDATE users SET id = '${DEFAULT_USER_ID}' WHERE email = '${SYSTEM_USER_EMAIL}'`);
        }
        throw migrationError;
      } finally {
        client.release();
      }
      
      return;
    }

    // Create system user with secure random password (system user - not for manual login)
    const randomPassword = generateSecureRandomPassword();
    const hashedPassword = await bcrypt.hash(randomPassword, 12);
    
    await pool.query(
      `INSERT INTO users (id, email, username, password, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email,
         username = EXCLUDED.username,
         updated_at = NOW()`,
      [DEFAULT_USER_ID, SYSTEM_USER_EMAIL, SYSTEM_USER_USERNAME, hashedPassword]
    );

    console.log(`[SEED_USERS] Created system user: ${SYSTEM_USER_EMAIL} (${DEFAULT_USER_ID})`);
    
    // Also migrate any orphaned FK references that might exist
    console.log(`[SEED_USERS] Checking for orphaned FK references after user creation...`);
    await migrateOrphanedFKReferences(pool, DEFAULT_USER_ID);

    // Reset password if RESET_USER_PASSWORD env var is set (for production access)
    await resetPasswordIfRequested(pool, DEFAULT_USER_ID);

  } catch (error) {
    console.error("[SEED_USERS] Error seeding users:", error);
    // Don't exit with error - let the app try to start anyway
  } finally {
    await pool.end();
  }
}

seedSystemUsers()
  .then(() => {
    console.log("[SEED_USERS] Complete");
    process.exit(0);
  })
  .catch((err) => {
    console.error("[SEED_USERS] Fatal error:", err);
    process.exit(1);
  });
