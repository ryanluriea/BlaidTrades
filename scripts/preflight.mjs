#!/usr/bin/env node
/**
 * Preflight Environment Validation
 * Verifies required environment variables and dependencies before startup.
 * Fails fast with clear messages if anything is missing.
 */

import { existsSync } from 'fs';
import { execSync } from 'child_process';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

const errors = [];
const warnings = [];

function log(color, prefix, message) {
  console.log(`${color}${prefix}${RESET} ${message}`);
}

function checkEnvVar(name, { required = true, format = null, example = null } = {}) {
  const value = process.env[name];
  
  if (!value || value.trim() === '') {
    if (required) {
      errors.push(`Missing required env var: ${name}${example ? ` (example: ${example})` : ''}`);
    } else {
      warnings.push(`Optional env var not set: ${name}`);
    }
    return false;
  }
  
  if (format && !format.test(value)) {
    errors.push(`Invalid format for ${name}: expected ${format.toString()}`);
    return false;
  }
  
  return true;
}

function checkNodeVersion() {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0], 10);
  
  if (major < 18) {
    errors.push(`Node.js version ${version} is too old. Required: >= 18.0.0`);
    return false;
  }
  
  log(GREEN, '[OK]', `Node.js ${version}`);
  return true;
}

function checkDatabaseUrl() {
  const dbUrl = process.env.DATABASE_URL;
  
  if (!dbUrl) {
    errors.push('Missing DATABASE_URL - cannot connect to PostgreSQL');
    return false;
  }
  
  const pgPattern = /^postgres(ql)?:\/\/.+:.+@.+:\d+\/.+$/;
  if (!pgPattern.test(dbUrl)) {
    errors.push('DATABASE_URL format invalid. Expected: postgres://user:pass@host:port/database');
    return false;
  }
  
  log(GREEN, '[OK]', 'DATABASE_URL format valid');
  return true;
}

function checkPackageJson() {
  if (!existsSync('package.json')) {
    errors.push('package.json not found in current directory');
    return false;
  }
  
  log(GREEN, '[OK]', 'package.json exists');
  return true;
}

function checkNodeModules() {
  if (!existsSync('node_modules')) {
    warnings.push('node_modules not found - run npm install first');
    return false;
  }
  
  log(GREEN, '[OK]', 'node_modules exists');
  return true;
}

// ===================
// Run All Checks
// ===================

console.log('\n========================================');
console.log('  BlaidAgent Preflight Checks');
console.log('========================================\n');

// 1. Node version
checkNodeVersion();

// 2. Package structure
checkPackageJson();
checkNodeModules();

// 3. Required environment variables
console.log('\nChecking environment variables...\n');

checkDatabaseUrl();
checkEnvVar('SESSION_SECRET', { 
  required: false, 
  example: 'your-secret-min-32-chars' 
});

// 4. Optional integrations
checkEnvVar('DATABENTO_API_KEY', { required: false });
checkEnvVar('POLYGON_API_KEY', { required: false });
checkEnvVar('OPENAI_API_KEY', { required: false });
checkEnvVar('ANTHROPIC_API_KEY', { required: false });

// ===================
// Report Results
// ===================

console.log('\n----------------------------------------');

if (warnings.length > 0) {
  console.log(`\n${YELLOW}Warnings:${RESET}`);
  warnings.forEach(w => console.log(`  - ${w}`));
}

if (errors.length > 0) {
  console.log(`\n${RED}Errors:${RESET}`);
  errors.forEach(e => console.log(`  - ${e}`));
  console.log(`\n${RED}Preflight FAILED${RESET} - fix the above errors before starting.\n`);
  process.exit(1);
} else {
  console.log(`\n${GREEN}Preflight PASSED${RESET} - environment is ready.\n`);
  process.exit(0);
}
