/**
 * One-time script to create admin account in production database
 * Run with: npx tsx scripts/create-admin-account.ts
 * 
 * After running, delete this script for security
 */

import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const { Pool } = pg;

async function createAdminAccount() {
  const DATABASE_URL = process.env.DATABASE_URL;
  
  if (!DATABASE_URL) {
    console.error("ERROR: DATABASE_URL environment variable not set");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // Admin account details
    const email = "blaidtrades@gmail.com";
    const username = "blaidtrades";
    
    // Generate a secure temporary password
    const tempPassword = crypto.randomBytes(12).toString("base64").slice(0, 16);
    const hashedPassword = await bcrypt.hash(tempPassword, 10);
    const userId = crypto.randomUUID();

    // Check if user already exists
    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (existing.rows.length > 0) {
      console.log(`\n⚠️  User ${email} already exists!`);
      console.log(`   User ID: ${existing.rows[0].id}`);
      console.log(`\n   If you forgot your password, you can update it with:`);
      console.log(`   UPDATE users SET password = '<new_hash>' WHERE email = '${email}';`);
      process.exit(0);
    }

    // Insert new user
    await pool.query(
      `INSERT INTO users (id, email, username, password, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [userId, email, username, hashedPassword]
    );

    console.log("\n✅ Admin account created successfully!\n");
    console.log("   Email:", email);
    console.log("   Temporary Password:", tempPassword);
    console.log("\n   ⚠️  IMPORTANT: Change this password immediately after login!");
    console.log("   ⚠️  Delete this script after use for security.\n");

  } catch (error) {
    console.error("Failed to create admin account:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

createAdminAccount();
