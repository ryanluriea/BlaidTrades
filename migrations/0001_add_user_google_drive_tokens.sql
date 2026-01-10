-- Migration: Add user_google_drive_tokens table for Google Drive OAuth
-- Created: 2026-01-10
-- Description: Stores OAuth tokens for Google Drive backup/restore functionality

CREATE TABLE IF NOT EXISTS user_google_drive_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_type TEXT DEFAULT 'Bearer',
  scope TEXT,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index for user_id lookups
CREATE INDEX IF NOT EXISTS idx_user_google_drive_tokens_user_id 
  ON user_google_drive_tokens(user_id);
