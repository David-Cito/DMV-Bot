-- Migration: Add failed_notifications table
-- Tracks failed SMS delivery attempts for monitoring and retry
-- See openspec/specs/database/spec.md

-- ============================================================================
-- FAILED_NOTIFICATIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS failed_notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id),
  phone             TEXT NOT NULL,           -- E.164 normalized number
  message_type      TEXT NOT NULL,           -- 'invite', 'booked', 'payment_failed', etc.
  message_body      TEXT NOT NULL,           -- Full SMS body for potential retry

  -- Error details
  error             TEXT NOT NULL,           -- Twilio error message
  error_code        TEXT,                    -- Twilio error code (e.g., 21211, 21408)

  -- Retry tracking
  retry_count       INTEGER NOT NULL DEFAULT 0,
  last_retry_at     TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying failures by user
CREATE INDEX IF NOT EXISTS idx_failed_notifications_user
  ON failed_notifications (user_id, created_at DESC);

-- Index for querying failures by phone number
CREATE INDEX IF NOT EXISTS idx_failed_notifications_phone
  ON failed_notifications (phone, created_at DESC);

-- Index for analyzing error patterns
CREATE INDEX IF NOT EXISTS idx_failed_notifications_error_code
  ON failed_notifications (error_code)
  WHERE error_code IS NOT NULL;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
