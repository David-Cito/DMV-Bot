# Database Schema

> **Last Updated:** February 2026

---

## Overview

All data is stored in Supabase (PostgreSQL). Tables are organized by concern:

- **Core** - Users, locations, queue entries
- **Bookings** - Slots, locks, completed bookings
- **Payments** - Transactions
- **Analytics** - Bot runs, attempts, state history, metrics
- **Configuration** - Admin settings

---

## Core Tables

### users

Basic user information.

```sql
CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone             TEXT UNIQUE NOT NULL,
  email             TEXT,
  name              TEXT,
  stripe_customer_id TEXT,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);
```

### locations

DMV locations with pricing and queue settings.

```sql
CREATE TABLE locations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  code              TEXT UNIQUE NOT NULL,
  pricing_tier      TEXT NOT NULL DEFAULT 'standard', -- 'standard' or 'high_traffic'
  queue_size_limit  INTEGER NOT NULL DEFAULT 5,
  is_active         BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMP DEFAULT NOW()
);

-- Seed data
INSERT INTO locations (name, code, pricing_tier, queue_size_limit) VALUES
  ('Downtown Satellite City Hall', 'downtown', 'high_traffic', 8),
  ('Hawaii Kai Satellite City Hall', 'hawaii_kai', 'standard', 6),
  ('Pearlridge Satellite City Hall', 'pearlridge', 'high_traffic', 8),
  ('Windward City Satellite City Hall', 'windward', 'standard', 4);
```

### queue_entries

User's place in the system (waitlist, pre-queue, or queue).

```sql
CREATE TABLE queue_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) NOT NULL,
  location_id       UUID REFERENCES locations(id) NOT NULL,

  -- User preferences
  tier              TEXT NOT NULL, -- 'priority' or 'flexible'
  time_preference   TEXT, -- 'morning', 'midday', 'afternoon', or NULL (any)

  -- State
  state             TEXT NOT NULL DEFAULT 'waiting',
  -- States: waiting, invited, ready, active, booking, booked,
  --         payment_issue, confirmed, completed, canceled, expired

  -- Booking tracking (when state = 'booking')
  booking_bot_id    UUID,
  booking_started_at TIMESTAMP,
  booking_slot_id   UUID,

  -- Timestamps
  invited_at        TIMESTAMP,
  deposit_paid_at   TIMESTAMP,
  queue_entered_at  TIMESTAMP,
  booked_at         TIMESTAMP,

  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW(),

  UNIQUE (user_id, location_id)
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
```

---

## Booking Tables

### slot_states

Detected appointment slots from monitoring bot. (Already exists, keeping as-is)

### slot_locks

Prevent duplicate booking attempts on the same slot.

```sql
CREATE TABLE slot_locks (
  lock_key          TEXT PRIMARY KEY, -- format: location_date_time
  locked_by_bot_id  UUID NOT NULL,
  locked_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMP NOT NULL
);

CREATE INDEX idx_slot_locks_expires ON slot_locks (expires_at);
```

### bookings

Successful bookings.

```sql
CREATE TABLE bookings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) NOT NULL,
  queue_entry_id    UUID REFERENCES queue_entries(id) NOT NULL,
  location_id       UUID REFERENCES locations(id) NOT NULL,

  -- Appointment details
  appointment_date  DATE NOT NULL,
  appointment_time  TIME NOT NULL,

  -- DMV confirmation
  dmv_confirmation_number TEXT,

  -- Status
  status            TEXT NOT NULL DEFAULT 'booked', -- booked, confirmed, canceled, completed
  cancel_window_ends_at TIMESTAMP,

  -- Payment
  booking_fee_cents INTEGER NOT NULL,
  stripe_charge_id  TEXT,

  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_bookings_user ON bookings (user_id, created_at DESC);
CREATE INDEX idx_bookings_status ON bookings (status, created_at DESC);
```

---

## Payment Tables

### transactions

All money movement.

```sql
CREATE TABLE transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) NOT NULL,
  queue_entry_id    UUID REFERENCES queue_entries(id),
  booking_id        UUID REFERENCES bookings(id),

  type              TEXT NOT NULL, -- 'deposit', 'booking_fee', 'refund_deposit', 'refund_booking'
  amount_cents      INTEGER NOT NULL,

  location_id       UUID REFERENCES locations(id),
  tier              TEXT,

  -- Stripe
  stripe_payment_id TEXT,
  stripe_refund_id  TEXT,

  status            TEXT NOT NULL DEFAULT 'pending', -- pending, completed, failed, refunded

  metadata          JSONB,
  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_transactions_user ON transactions (user_id, created_at DESC);
CREATE INDEX idx_transactions_type ON transactions (type, created_at DESC);
CREATE INDEX idx_transactions_status ON transactions (status, created_at DESC);
```

---

## Analytics Tables

### bot_runs

Every bot execution.

```sql
CREATE TABLE bot_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_type          TEXT NOT NULL, -- 'monitor' or 'booking'
  started_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  ended_at          TIMESTAMP,
  status            TEXT, -- 'success', 'error', 'timeout'

  -- Stats
  slots_found       INTEGER DEFAULT 0,
  slots_new         INTEGER DEFAULT 0,
  users_attempted   INTEGER DEFAULT 0,
  booking_result    TEXT,
  booked_user_id    UUID,

  -- Error tracking
  error_message     TEXT,
  duration_ms       INTEGER,

  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_bot_runs_type ON bot_runs (bot_type, started_at DESC);
CREATE INDEX idx_bot_runs_status ON bot_runs (status, started_at DESC);
```

### booking_attempts

Every booking attempt per user.

```sql
CREATE TABLE booking_attempts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_run_id        UUID REFERENCES bot_runs(id),
  user_id           UUID REFERENCES users(id),
  slot_id           UUID,
  location_id       UUID REFERENCES locations(id),

  attempt_number    INTEGER, -- 1 = primary, 2 = backup
  slot_date         DATE,
  slot_time         TIME,

  started_at        TIMESTAMP DEFAULT NOW(),
  ended_at          TIMESTAMP,
  duration_ms       INTEGER,

  result            TEXT NOT NULL, -- 'success', 'payment_failed', 'submit_failed', 'skipped'
  error_code        TEXT,
  error_message     TEXT,

  payment_attempted BOOLEAN DEFAULT FALSE,
  payment_result    TEXT,
  stripe_charge_id  TEXT,
  amount_cents      INTEGER,

  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_booking_attempts_user ON booking_attempts (user_id, created_at DESC);
CREATE INDEX idx_booking_attempts_run ON booking_attempts (bot_run_id);
CREATE INDEX idx_booking_attempts_result ON booking_attempts (result, created_at DESC);
```

### user_state_history

Every state change.

```sql
CREATE TABLE user_state_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) NOT NULL,
  queue_entry_id    UUID REFERENCES queue_entries(id),

  from_state        TEXT,
  to_state          TEXT NOT NULL,

  trigger_type      TEXT, -- 'user_action', 'bot_action', 'system', 'admin', 'cleanup'
  trigger_details   JSONB,

  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_state_history_user ON user_state_history (user_id, created_at DESC);
CREATE INDEX idx_state_history_date ON user_state_history (created_at DESC);
```

### system_events

Errors, cleanups, alerts.

```sql
CREATE TABLE system_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type        TEXT NOT NULL,
  severity          TEXT DEFAULT 'info', -- 'info', 'warning', 'error'

  user_id           UUID,
  bot_run_id        UUID,

  details           JSONB,
  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_system_events_type ON system_events (event_type, created_at DESC);
CREATE INDEX idx_system_events_severity ON system_events (severity, created_at DESC);
```

### daily_metrics

Aggregated daily stats.

```sql
CREATE TABLE daily_metrics (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date              DATE NOT NULL,
  location_id       UUID REFERENCES locations(id), -- NULL for system-wide

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

  created_at        TIMESTAMP DEFAULT NOW(),
  UNIQUE (date, location_id)
);

CREATE INDEX idx_daily_metrics_date ON daily_metrics (date DESC);
```

---

## Configuration Tables

### admin_config

Runtime-adjustable settings.

```sql
CREATE TABLE admin_config (
  key               TEXT PRIMARY KEY,
  value             JSONB NOT NULL,
  description       TEXT,
  updated_at        TIMESTAMP DEFAULT NOW(),
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
```

---

## Message Log

For notification deduplication.

```sql
CREATE TABLE message_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) NOT NULL,
  message_type      TEXT NOT NULL,
  dedupe_key        TEXT UNIQUE NOT NULL,
  channel           TEXT DEFAULT 'sms', -- 'sms', 'email'
  sent_at           TIMESTAMP DEFAULT NOW(),
  metadata          JSONB
);

CREATE INDEX idx_message_log_user ON message_log (user_id, sent_at DESC);
CREATE INDEX idx_message_log_dedupe ON message_log (dedupe_key);
```

### failed_notifications

Failed SMS delivery attempts for monitoring and retry. Tracks Twilio errors to enable:
- Monitoring: Identify systematic delivery issues
- Retry: Implement retry queue for transient failures
- Debugging: Analyze error patterns by error code
- Audit: Which messages failed to reach which users

```sql
CREATE TABLE failed_notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) NOT NULL,
  phone             TEXT NOT NULL,           -- E.164 normalized number
  message_type      TEXT NOT NULL,           -- 'invite', 'booked', 'payment_failed', etc.
  message_body      TEXT NOT NULL,           -- Full SMS body for potential retry

  -- Error details
  error             TEXT NOT NULL,           -- Twilio error message
  error_code        TEXT,                    -- Twilio error code (e.g., 21211, 21408)

  -- Retry tracking
  retry_count       INTEGER DEFAULT 0,
  last_retry_at     TIMESTAMP,

  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_failed_notifications_user ON failed_notifications (user_id, created_at DESC);
CREATE INDEX idx_failed_notifications_phone ON failed_notifications (phone, created_at DESC);
CREATE INDEX idx_failed_notifications_error_code ON failed_notifications (error_code)
  WHERE error_code IS NOT NULL;
```

**Query Examples:**
```sql
-- All failures for a user
SELECT * FROM failed_notifications
WHERE user_id = $1
ORDER BY created_at DESC;

-- Failures by error code (to detect patterns)
SELECT error_code, COUNT(*) as count
FROM failed_notifications
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY error_code
ORDER BY count DESC;

-- Phone numbers with repeated failures
SELECT phone, COUNT(*) as failures, MAX(created_at) as latest
FROM failed_notifications
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY phone
HAVING COUNT(*) > 3
ORDER BY failures DESC;
```

---

## Admin Tables

### admin_actions

Track all manual admin interventions for audit trail.

```sql
CREATE TABLE admin_actions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type       TEXT NOT NULL,
  target_type       TEXT NOT NULL,  -- 'user', 'location', 'booking', 'system'
  target_id         UUID,
  details           JSONB NOT NULL,
  reason            TEXT,
  performed_by      TEXT NOT NULL,
  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_admin_actions_date ON admin_actions (created_at DESC);
CREATE INDEX idx_admin_actions_type ON admin_actions (action_type, created_at DESC);
```

---

## Interest Tracking

### service_votes

Track user interest in services we don't yet support. Used to inform expansion decisions.

Phone is always captured so we can notify voters when we launch a service - even if they didn't explicitly opt in.

```sql
CREATE TABLE service_votes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone             TEXT NOT NULL,           -- Always captured for launch notifications
  service_type      TEXT NOT NULL,
  description       TEXT,                    -- Free-text if 'other'
  notify_when_available BOOLEAN DEFAULT FALSE, -- User explicitly opted in
  notified_at       TIMESTAMP,               -- When we texted them about launch
  created_at        TIMESTAMP DEFAULT NOW()
);

-- service_type values:
-- 'license_id_duplicate'      (easy - same locations)
-- 'permit_renewal'            (easy - same locations)
-- 'motor_vehicle_services'    (easy - same locations)
-- 'instruction_permit'        (hard - DL offices only)
-- 'out_of_state_transfer'     (hard - DL offices only)
-- 'state_id_initial'          (hard - DL offices only)
-- 'other'                     (free-text in description)

CREATE INDEX idx_service_votes_type ON service_votes (service_type);
CREATE INDEX idx_service_votes_notify ON service_votes (service_type, notify_when_available)
  WHERE notify_when_available = TRUE AND notified_at IS NULL;
```

---

## Related Specs

- [Service Selection](../service-selection/spec.md) - Service voting flow
- [User States](../user-states/spec.md) - State enum values
- [Queue Mechanics](../queue-mechanics/spec.md) - Queue query patterns
- [Analytics](../analytics/spec.md) - How analytics tables are used
- [Admin Operations](../admin-operations/spec.md) - Manual intervention queries
