-- Migration: Queue and Target Windows System
-- See CLAUDE_IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md
-- This migration creates all new tables for the queue-based managed booking system.
-- It does NOT modify any existing monitoring tables.

-- ============================================================================
-- 1. target_window_presets (Section 4.1)
-- ============================================================================
CREATE TABLE target_window_presets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    preset_type TEXT NOT NULL,
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    rules_json JSONB NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT target_window_presets_preset_type_check
        CHECK (preset_type IN ('date_horizon', 'time_block', 'weekday_rule')),
    CONSTRAINT target_window_presets_preset_type_key_unique
        UNIQUE (preset_type, key)
);

CREATE INDEX idx_target_window_presets_type_active_sort
    ON target_window_presets (preset_type, active, sort_order);

-- ============================================================================
-- 2. customers (Section 5.1)
-- ============================================================================
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT UNIQUE NOT NULL,
    email TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 3. queue_entries (Section 5.2)
-- ============================================================================
CREATE TABLE queue_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL,
    deposit_status TEXT NOT NULL DEFAULT 'none',
    deposit_required_at TIMESTAMPTZ NULL,
    deposit_paid_at TIMESTAMPTZ NULL,
    deposit_expires_at TIMESTAMPTZ NULL,
    booked_at TIMESTAMPTZ NULL,
    booked_location_id UUID NULL REFERENCES locations(id),
    booked_slot_datetime TIMESTAMPTZ NULL,

    CONSTRAINT queue_entries_status_check
        CHECK (status IN ('queued', 'deposit_required', 'active', 'booked', 'paused', 'expired', 'canceled')),
    CONSTRAINT queue_entries_deposit_status_check
        CHECK (deposit_status IN ('none', 'required', 'paid', 'expired', 'refunded'))
);

CREATE INDEX idx_queue_entries_created_at
    ON queue_entries (created_at);

CREATE INDEX idx_queue_entries_status_created_at
    ON queue_entries (status, created_at);

CREATE INDEX idx_queue_entries_deposit_status_created_at
    ON queue_entries (deposit_status, created_at);

-- ============================================================================
-- 4. user_target_window_selections (Section 5.3)
-- ============================================================================
CREATE TABLE user_target_window_selections (
    customer_id UUID PRIMARY KEY REFERENCES customers(id),
    timezone TEXT NOT NULL DEFAULT 'Pacific/Honolulu',
    date_horizon_key TEXT NOT NULL,
    weekday_rule_key TEXT NOT NULL,
    custom_weekdays INT[] NOT NULL DEFAULT '{}',
    time_block_keys TEXT[] NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Ensure custom_weekdays only contains valid weekday numbers (1-5 for Mon-Fri)
    CONSTRAINT user_target_window_selections_custom_weekdays_check
        CHECK (custom_weekdays <@ ARRAY[1, 2, 3, 4, 5])
);

CREATE INDEX idx_user_target_window_selections_time_block_keys
    ON user_target_window_selections USING GIN (time_block_keys);

-- ============================================================================
-- 5. user_location_preferences (Section 5.4)
-- ============================================================================
CREATE TABLE user_location_preferences (
    customer_id UUID NOT NULL REFERENCES customers(id),
    location_id UUID NOT NULL REFERENCES locations(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (customer_id, location_id)
);

CREATE INDEX idx_user_location_preferences_location_id
    ON user_location_preferences (location_id);

-- ============================================================================
-- 6. queue_watermarks (Section 6.1)
-- ============================================================================
CREATE TABLE queue_watermarks (
    key TEXT PRIMARY KEY,
    last_processed_at TIMESTAMPTZ NOT NULL
);

-- ============================================================================
-- 7. booking_attempts (Section 6.2)
-- ============================================================================
CREATE TABLE booking_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    location_id UUID NOT NULL REFERENCES locations(id),
    slot_date DATE NOT NULL,
    slot_time TIME NOT NULL,
    slot_datetime_utc TIMESTAMPTZ NOT NULL,
    attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    result TEXT NOT NULL,
    error_code TEXT NULL,
    error_message TEXT NULL,
    dispatcher_run_id UUID NOT NULL,

    CONSTRAINT booking_attempts_result_check
        CHECK (result IN ('success', 'fail', 'skipped'))
);

CREATE INDEX idx_booking_attempts_dispatcher_run_id
    ON booking_attempts (dispatcher_run_id);

CREATE INDEX idx_booking_attempts_customer_id_attempt_at
    ON booking_attempts (customer_id, attempt_at DESC);

CREATE INDEX idx_booking_attempts_location_id_attempt_at
    ON booking_attempts (location_id, attempt_at DESC);

-- ============================================================================
-- 8. booking_locks (Section 6.3)
-- ============================================================================
CREATE TABLE booking_locks (
    lock_key TEXT PRIMARY KEY,
    locked_until TIMESTAMPTZ NOT NULL,
    owner_run_id UUID NOT NULL
);

CREATE INDEX idx_booking_locks_locked_until
    ON booking_locks (locked_until);

-- ============================================================================
-- 9. message_log (Section 6.4)
-- ============================================================================
CREATE TABLE message_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    message_type TEXT NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    dedupe_key TEXT NOT NULL,
    meta_json JSONB NULL,

    CONSTRAINT message_log_message_type_check
        CHECK (message_type IN ('deposit_needed', 'deposit_received', 'booked', 'opportunity_passed', 'status')),
    CONSTRAINT message_log_dedupe_key_unique
        UNIQUE (dedupe_key)
);

CREATE INDEX idx_message_log_customer_id_sent_at
    ON message_log (customer_id, sent_at DESC);

-- ============================================================================
-- SEED DATA: target_window_presets (Section 4.2)
-- ============================================================================

-- Date horizon presets
INSERT INTO target_window_presets (preset_type, key, label, rules_json, sort_order) VALUES
    ('date_horizon', 'soonest', 'Soonest Available', '{"days_ahead": 365}', 1),
    ('date_horizon', 'w4', 'Within 4 Weeks', '{"days_ahead": 28}', 2),
    ('date_horizon', 'w8', 'Within 8 Weeks', '{"days_ahead": 56}', 3),
    ('date_horizon', 'w12', 'Within 12 Weeks', '{"days_ahead": 84}', 4);

-- Time block presets (all times in Honolulu local time)
INSERT INTO target_window_presets (preset_type, key, label, rules_json, sort_order) VALUES
    ('time_block', 'early', 'Early Morning', '{"start": "08:00", "end": "09:45"}', 1),
    ('time_block', 'late', 'Late Morning', '{"start": "10:00", "end": "11:45"}', 2),
    ('time_block', 'midday', 'Midday', '{"start": "12:00", "end": "13:45"}', 3),
    ('time_block', 'afternoon', 'Afternoon', '{"start": "14:00", "end": "15:45"}', 4);

-- Weekday rule presets
INSERT INTO target_window_presets (preset_type, key, label, rules_json, sort_order) VALUES
    ('weekday_rule', 'any_weekday', 'Any Weekday', '{"mode": "any"}', 1),
    ('weekday_rule', 'custom_weekdays', 'Pick Weekdays', '{"mode": "custom"}', 2);

-- ============================================================================
-- SEED DATA: queue_watermarks (Section 6.1)
-- ============================================================================
INSERT INTO queue_watermarks (key, last_processed_at) VALUES
    ('slot_opened', now() - INTERVAL '10 minutes');

-- ============================================================================
-- 10. RPC FUNCTIONS (Section 6.3 and 8)
-- ============================================================================

-- Function: acquire_booking_lock
-- Atomic lock acquisition using database now() for all time comparisons.
-- Returns true if lock was acquired, false on contention.
CREATE OR REPLACE FUNCTION acquire_booking_lock(
    p_lock_key TEXT,
    p_owner_run_id UUID,
    p_ttl_seconds INT
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_locked_until TIMESTAMPTZ;
    v_now TIMESTAMPTZ := now();
BEGIN
    -- Try to insert a new lock row
    INSERT INTO booking_locks (lock_key, locked_until, owner_run_id)
    VALUES (p_lock_key, v_now + (p_ttl_seconds || ' seconds')::INTERVAL, p_owner_run_id)
    ON CONFLICT (lock_key) DO UPDATE
    SET
        locked_until = v_now + (p_ttl_seconds || ' seconds')::INTERVAL,
        owner_run_id = p_owner_run_id
    WHERE booking_locks.locked_until < v_now;

    -- Check if we acquired the lock
    -- ROW_COUNT = 1 means we either inserted or updated
    IF FOUND THEN
        RETURN TRUE;
    ELSE
        RETURN FALSE;
    END IF;
END;
$$;

-- Function: fetch_opened_slots_since
-- Uses database now() for lookback filtering.
CREATE OR REPLACE FUNCTION fetch_opened_slots_since(
    p_watermark TIMESTAMPTZ,
    p_lookback_minutes INT
) RETURNS TABLE (
    location_id UUID,
    date DATE,
    time TIME,
    first_seen TIMESTAMPTZ,
    last_seen TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT
        location_id,
        date,
        time,
        first_seen,
        last_seen
    FROM slot_states
    WHERE
        first_seen > p_watermark
        AND last_seen > now() - make_interval(mins => p_lookback_minutes)
        AND date IS NOT NULL
        AND time IS NOT NULL
    ORDER BY first_seen ASC;
$$;
