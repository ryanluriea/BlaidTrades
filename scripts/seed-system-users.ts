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
      console.log(`[SEED_USERS] User exists with different ID: ${userByEmail.rows[0].id}`);
      console.log(`[SEED_USERS] Expected ID: ${DEFAULT_USER_ID}`);
      // Update strategy-lab-engine.ts to use the correct ID, or update the user ID
      // For now, we'll create the expected user
    }

    // Create system user with secure random password (system user - not for manual login)
    const randomPassword = generateSecureRandomPassword();
    const hashedPassword = await bcrypt.hash(randomPassword, 12);
    
    await pool.query(
      `INSERT INTO users (id, email, username, password_hash, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'admin', NOW(), NOW())
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
