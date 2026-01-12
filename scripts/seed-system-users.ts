#!/usr/bin/env tsx
/**
 * System User Seeding Script - Ensures DEFAULT_USER_ID exists
 * 
 * This script ensures the system/default user account exists in the database.
 * It's designed to be idempotent - safe to run multiple times.
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
        
        // Migrate any orphaned data from wrong ID to DEFAULT_USER_ID
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
        
        // Now update the user's ID to DEFAULT_USER_ID
        // This should succeed since we moved all dependent data first
        await client.query(
          `UPDATE users SET id = $1, updated_at = NOW() WHERE email = $2`,
          [DEFAULT_USER_ID, SYSTEM_USER_EMAIL]
        );
        
        await client.query('COMMIT');
        console.log(`[SEED_USERS] SUCCESS: User ${SYSTEM_USER_EMAIL} now has ID ${DEFAULT_USER_ID}`);
        console.log(`[SEED_USERS] All bots and data are now accessible`);
        
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
