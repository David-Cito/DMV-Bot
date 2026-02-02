-- Migration: Queue System V2
-- This migration replaces the old queue system with the new design.
-- See openspec/specs/ for full documentation.

-- ============================================================================
-- PART 1: DROP OLD QUEUE TABLES
-- ============================================================================
-- Drop in reverse dependency order

DROP FUNCTION IF EXISTS fetch_opened_slots_since(TIMESTAMPTZ, INT);
DROP FUNCTION IF EXISTS acquire_booking_lock(TEXT, UUID, INT);

DROP TABLE IF EXISTS message_log CASCADE;
DROP TABLE IF EXISTS booking_locks CASCADE;
DROP TABLE IF EXISTS booking_attempts CASCADE;
DROP TABLE IF EXISTS queue_watermarks CASCADE;
DROP TABLE IF EXISTS user_location_preferences CASCADE;
DROP TABLE IF EXISTS user_target_window_selections CASCADE;
DROP TABLE IF EXISTS queue_entries CASCADE;
DROP TABLE IF EXISTS queue_entries_v2 CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS target_window_presets CASCADE;

-- ============================================================================
-- PART 2: ALTER LOCATIONS TABLE
-- ============================================================================
-- Add new columns to existing locations table

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS pricing_tier TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS queue_size_limit INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Add constraint for pricing_tier
ALTER TABLE locations
  ADD CONSTRAINT locations_pricing_tier_check
  CHECK (pricing_tier IN ('standard', 'high_traffic'));

-- Update existing locations with appropriate pricing tiers
-- Hawaii Kai is high traffic, all others are standard
UPDATE locations SET pricing_tier = 'high_traffic' WHERE name ILIKE '%hawaii kai%';
UPDATE locations SET pricing_tier = 'standard' WHERE name NOT ILIKE '%hawaii kai%';

-- ============================================================================
-- PART 3: USERS TABLE
-- ============================================================================

CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone             TEXT UNIQUE NOT NULL,
  email             TEXT,
  name              TEXT,
  stripe_customer_id TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_phone ON users (phone);
CREATE INDEX idx_users_stripe_customer ON users (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- ============================================================================
-- PART 4: QUEUE_ENTRIES TABLE
-- ============================================================================

CREATE TABLE queue_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id),
  location_id       UUID NOT NULL REFERENCES locations(id),

  -- User preferences
  tier              TEXT NOT NULL,
  time_preference   TEXT,

  -- State
  state             TEXT NOT NULL DEFAULT 'waiting',

  -- Booking tracking (when state = 'booking')
  booking_bot_id    UUID,
  booking_started_at TIMESTAMPTZ,
  booking_slot_id   UUID,

  -- Timestamps
  invited_at        TIMESTAMPTZ,
  deposit_paid_at   TIMESTAMPTZ,
  queue_entered_at  TIMESTAMPTZ,
  booked_at         TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT queue_entries_user_location_unique UNIQUE (user_id, location_id),
  CONSTRAINT queue_entries_tier_check CHECK (tier IN ('priority', 'flexible')),
  CONSTRAINT queue_entries_time_preference_check CHECK (time_preference IS NULL OR time_preference IN ('morning', 'midday', 'afternoon')),
  CONSTRAINT queue_entries_state_check CHECK (state IN ('waiting', 'invited', 'ready', 'active', 'booking', 'booked', 'payment_issue', 'confirmed', 'completed', 'canceled', 'expired'))
);

-- Indexes for queue queries
CREATE INDEX idx_queue_active ON queue_entries (location_id, state, tier, created_at)
  WHERE state = 'active';
CREATE INDEX idx_queue_waiting ON queue_entries (location_id, state, created_at)
  WHERE state = 'waiting';
CREATE INDEX idx_queue_invited ON queue_entries (state, invited_at)
  WHERE state = 'invited';
CREATE INDEX idx_queue_booking ON queue_entries (state, booking_started_at)
  WHERE state = 'booking';
CREATE INDEX idx_queue_ready ON queue_entries (location_id, state, tier, deposit_paid_at)
  WHERE state = 'ready';

-- ============================================================================
-- PART 5: SLOT_LOCKS TABLE
-- ============================================================================

CREATE TABLE slot_locks (
  lock_key          TEXT PRIMARY KEY,
  locked_by_bot_id  UUID NOT NULL,
  locked_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_slot_locks_expires ON slot_locks (expires_at);

-- ============================================================================
-- PART 6: BOOKINGS TABLE
-- ============================================================================

CREATE TABLE bookings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id),
  queue_entry_id    UUID NOT NULL REFERENCES queue_entries(id),
  location_id       UUID NOT NULL REFERENCES locations(id),

  -- Appointment details
  appointment_date  DATE NOT NULL,
  appointment_time  TIME NOT NULL,

  -- DMV confirmation
  dmv_confirmation_number TEXT,

  -- Status
  status            TEXT NOT NULL DEFAULT 'booked',
  cancel_window_ends_at TIMESTAMPTZ,

  -- Payment
  booking_fee_cents INTEGER NOT NULL,
  stripe_charge_id  TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT bookings_status_check CHECK (status IN ('booked', 'confirmed', 'canceled', 'completed'))
);

CREATE INDEX idx_bookings_user ON bookings (user_id, created_at DESC);
CREATE INDEX idx_bookings_status ON bookings (status, created_at DESC);
CREATE INDEX idx_bookings_location ON bookings (location_id, created_at DESC);

-- ============================================================================
-- PART 7: TRANSACTIONS TABLE
-- ============================================================================

CREATE TABLE transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id),
  queue_entry_id    UUID REFERENCES queue_entries(id),
  booking_id        UUID REFERENCES bookings(id),

  type              TEXT NOT NULL,
  amount_cents      INTEGER NOT NULL,

  location_id       UUID REFERENCES locations(id),
  tier              TEXT,

  -- Stripe
  stripe_payment_id TEXT,
  stripe_refund_id  TEXT,

  status            TEXT NOT NULL DEFAULT 'pending',

  metadata          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT transactions_type_check CHECK (type IN ('deposit', 'booking_fee', 'refund_deposit', 'refund_booking')),
  CONSTRAINT transactions_status_check CHECK (status IN ('pending', 'completed', 'failed', 'refunded'))
);

CREATE INDEX idx_transactions_user ON transactions (user_id, created_at DESC);
CREATE INDEX idx_transactions_type ON transactions (type, created_at DESC);
CREATE INDEX idx_transactions_status ON transactions (status, created_at DESC);

-- ============================================================================
-- PART 8: BOT_RUNS TABLE
-- ============================================================================

CREATE TABLE bot_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_type          TEXT NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at          TIMESTAMPTZ,
  status            TEXT,

  -- Stats
  slots_found       INTEGER DEFAULT 0,
  slots_new         INTEGER DEFAULT 0,
  users_attempted   INTEGER DEFAULT 0,
  booking_result    TEXT,
  booked_user_id    UUID,

  -- Error tracking
  error_message     TEXT,
  duration_ms       INTEGER,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT bot_runs_type_check CHECK (bot_type IN ('monitor', 'booking', 'cleanup')),
  CONSTRAINT bot_runs_status_check CHECK (status IS NULL OR status IN ('success', 'error', 'timeout'))
);

CREATE INDEX idx_bot_runs_type ON bot_runs (bot_type, started_at DESC);
CREATE INDEX idx_bot_runs_status ON bot_runs (status, started_at DESC);

-- ============================================================================
-- PART 9: BOOKING_ATTEMPTS TABLE
-- ============================================================================

CREATE TABLE booking_attempts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_run_id        UUID REFERENCES bot_runs(id),
  user_id           UUID REFERENCES users(id),
  slot_id           UUID,
  location_id       UUID REFERENCES locations(id),

  attempt_number    INTEGER,
  slot_date         DATE,
  slot_time         TIME,

  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at          TIMESTAMPTZ,
  duration_ms       INTEGER,

  result            TEXT NOT NULL,
  error_code        TEXT,
  error_message     TEXT,

  payment_attempted BOOLEAN DEFAULT FALSE,
  payment_result    TEXT,
  stripe_charge_id  TEXT,
  amount_cents      INTEGER,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT booking_attempts_result_check CHECK (result IN ('success', 'payment_failed', 'submit_failed', 'slot_taken', 'skipped'))
);

CREATE INDEX idx_booking_attempts_user ON booking_attempts (user_id, created_at DESC);
CREATE INDEX idx_booking_attempts_run ON booking_attempts (bot_run_id);
CREATE INDEX idx_booking_attempts_result ON booking_attempts (result, created_at DESC);

-- ============================================================================
-- PART 10: USER_STATE_HISTORY TABLE
-- ============================================================================

CREATE TABLE user_state_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id),
  queue_entry_id    UUID REFERENCES queue_entries(id),

  from_state        TEXT,
  to_state          TEXT NOT NULL,

  trigger_type      TEXT,
  trigger_details   JSONB,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT state_history_trigger_check CHECK (trigger_type IS NULL OR trigger_type IN ('user_action', 'bot_action', 'system', 'admin', 'cleanup'))
);

CREATE INDEX idx_state_history_user ON user_state_history (user_id, created_at DESC);
CREATE INDEX idx_state_history_date ON user_state_history (created_at DESC);

-- ============================================================================
-- PART 11: SYSTEM_EVENTS TABLE
-- ============================================================================

CREATE TABLE system_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type        TEXT NOT NULL,
  severity          TEXT NOT NULL DEFAULT 'info',

  user_id           UUID,
  bot_run_id        UUID,

  details           JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT system_events_severity_check CHECK (severity IN ('info', 'warning', 'error'))
);

CREATE INDEX idx_system_events_type ON system_events (event_type, created_at DESC);
CREATE INDEX idx_system_events_severity ON system_events (severity, created_at DESC);

-- ============================================================================
-- PART 12: DAILY_METRICS TABLE
-- ============================================================================

CREATE TABLE daily_metrics (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date              DATE NOT NULL,
  location_id       UUID REFERENCES locations(id),

  slots_detected    INTEGER DEFAULT 0,
  slots_booked      INTEGER DEFAULT 0,

  booking_attempts  INTEGER DEFAULT 0,
  bookings_success  INTEGER DEFAULT 0,

  payments_attempted INTEGER DEFAULT 0,
  payments_failed    INTEGER DEFAULT 0,
  payment_failure_rate DECIMAL(5,2),

  deposits_collected_cents INTEGER DEFAULT 0,
  booking_fees_collected_cents INTEGER DEFAULT 0,
  refunds_issued_cents INTEGER DEFAULT 0,
  net_revenue_cents INTEGER DEFAULT 0,

  users_waitlist    INTEGER DEFAULT 0,
  users_active      INTEGER DEFAULT 0,
  new_signups       INTEGER DEFAULT 0,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT daily_metrics_unique UNIQUE (date, location_id)
);

CREATE INDEX idx_daily_metrics_date ON daily_metrics (date DESC);

-- ============================================================================
-- PART 13: ADMIN_CONFIG TABLE
-- ============================================================================

CREATE TABLE admin_config (
  key               TEXT PRIMARY KEY,
  value             JSONB NOT NULL,
  description       TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by        TEXT
);

-- Seed default config
INSERT INTO admin_config (key, value, description) VALUES
  ('pricing_standard_flexible', '{"deposit_cents": 500, "booking_fee_cents": 2500}', 'Standard location, Flexible tier pricing'),
  ('pricing_standard_priority', '{"deposit_cents": 1000, "booking_fee_cents": 3000}', 'Standard location, Priority tier pricing'),
  ('pricing_high_traffic_flexible', '{"deposit_cents": 1000, "booking_fee_cents": 3500}', 'High-traffic location, Flexible tier pricing'),
  ('pricing_high_traffic_priority', '{"deposit_cents": 1500, "booking_fee_cents": 4000}', 'High-traffic location, Priority tier pricing'),
  ('deposit_payment_window_hours', '24', 'Hours to pay deposit after invite'),
  ('cancel_window_enabled', 'true', 'Whether cancel window is active'),
  ('cancel_window_seconds', '600', 'Cancel window duration (10 min default)'),
  ('payment_issue_timeout_days', '7', 'Days before payment_issue state expires'),
  ('flexible_window_min_days', '7', 'Minimum days for flexible tier'),
  ('flexible_window_max_days', '28', 'Maximum days for flexible tier'),
  ('priority_window_days', '14', 'Days for priority tier');

-- ============================================================================
-- PART 14: MESSAGE_LOG TABLE
-- ============================================================================

CREATE TABLE message_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id),
  message_type      TEXT NOT NULL,
  dedupe_key        TEXT UNIQUE NOT NULL,
  channel           TEXT NOT NULL DEFAULT 'sms',
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata          JSONB
);

CREATE INDEX idx_message_log_user ON message_log (user_id, sent_at DESC);
CREATE INDEX idx_message_log_dedupe ON message_log (dedupe_key);

-- ============================================================================
-- PART 15: ADMIN_ACTIONS TABLE
-- ============================================================================

CREATE TABLE admin_actions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type       TEXT NOT NULL,
  target_type       TEXT NOT NULL,
  target_id         UUID,
  details           JSONB NOT NULL,
  reason            TEXT,
  performed_by      TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT admin_actions_target_type_check CHECK (target_type IN ('user', 'location', 'booking', 'system'))
);

CREATE INDEX idx_admin_actions_date ON admin_actions (created_at DESC);
CREATE INDEX idx_admin_actions_type ON admin_actions (action_type, created_at DESC);

-- ============================================================================
-- PART 16: HELPER FUNCTIONS
-- ============================================================================

-- Function: Acquire slot lock atomically
CREATE OR REPLACE FUNCTION acquire_slot_lock(
  p_lock_key TEXT,
  p_bot_id UUID,
  p_ttl_seconds INTEGER DEFAULT 300
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- Try to insert or update expired lock
  INSERT INTO slot_locks (lock_key, locked_by_bot_id, locked_at, expires_at)
  VALUES (p_lock_key, p_bot_id, v_now, v_now + (p_ttl_seconds || ' seconds')::INTERVAL)
  ON CONFLICT (lock_key) DO UPDATE
  SET locked_by_bot_id = p_bot_id,
      locked_at = v_now,
      expires_at = v_now + (p_ttl_seconds || ' seconds')::INTERVAL
  WHERE slot_locks.expires_at < v_now;

  -- Check if we got the lock
  RETURN FOUND;
END;
$$;

-- Function: Release slot lock
CREATE OR REPLACE FUNCTION release_slot_lock(
  p_lock_key TEXT,
  p_bot_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM slot_locks
  WHERE lock_key = p_lock_key
    AND locked_by_bot_id = p_bot_id;

  RETURN FOUND;
END;
$$;

-- Function: Select and lock eligible users for booking
CREATE OR REPLACE FUNCTION select_users_for_booking(
  p_location_id UUID,
  p_time_block TEXT,
  p_bot_id UUID,
  p_slot_id UUID,
  p_limit INTEGER DEFAULT 2
) RETURNS TABLE (
  id UUID,
  user_id UUID,
  tier TEXT,
  time_preference TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH eligible AS (
    SELECT qe.id, qe.user_id, qe.tier, qe.time_preference, qe.created_at
    FROM queue_entries qe
    WHERE qe.location_id = p_location_id
      AND qe.state = 'active'
      AND (qe.time_preference IS NULL OR qe.time_preference = p_time_block)
    ORDER BY
      CASE WHEN qe.tier = 'priority' THEN 0 ELSE 1 END,
      qe.created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE queue_entries qe
  SET state = 'booking',
      booking_bot_id = p_bot_id,
      booking_started_at = NOW(),
      booking_slot_id = p_slot_id,
      updated_at = NOW()
  FROM eligible e
  WHERE qe.id = e.id
  RETURNING qe.id, qe.user_id, qe.tier, qe.time_preference;
END;
$$;

-- Function: Log state change
CREATE OR REPLACE FUNCTION log_state_change(
  p_user_id UUID,
  p_queue_entry_id UUID,
  p_from_state TEXT,
  p_to_state TEXT,
  p_trigger_type TEXT,
  p_trigger_details JSONB DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO user_state_history (user_id, queue_entry_id, from_state, to_state, trigger_type, trigger_details)
  VALUES (p_user_id, p_queue_entry_id, p_from_state, p_to_state, p_trigger_type, p_trigger_details)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Function: Cleanup expired slot locks
CREATE OR REPLACE FUNCTION cleanup_expired_locks() RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM slot_locks
  WHERE expires_at < NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Function: Reset stuck booking states
CREATE OR REPLACE FUNCTION reset_stuck_bookings(
  p_timeout_minutes INTEGER DEFAULT 10
) RETURNS TABLE (
  user_id UUID,
  queue_entry_id UUID,
  stuck_since TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH stuck AS (
    SELECT qe.id, qe.user_id, qe.booking_started_at
    FROM queue_entries qe
    WHERE qe.state = 'booking'
      AND qe.booking_started_at < NOW() - (p_timeout_minutes || ' minutes')::INTERVAL
    FOR UPDATE
  )
  UPDATE queue_entries qe
  SET state = 'active',
      booking_bot_id = NULL,
      booking_started_at = NULL,
      booking_slot_id = NULL,
      updated_at = NOW()
  FROM stuck s
  WHERE qe.id = s.id
  RETURNING qe.user_id, qe.id AS queue_entry_id, s.booking_started_at AS stuck_since;
END;
$$;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
