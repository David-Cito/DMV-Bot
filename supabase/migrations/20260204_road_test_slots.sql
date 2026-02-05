-- Migration: Road Test Appointment Tracking
-- This migration creates tables for the road test bot to track slot availability,
-- scan history, and notification state.
-- See openspec/specs/road-test-bot/spec.md for documentation.

-- ============================================================================
-- PART 1: ROAD_TEST_SLOTS TABLE
-- ============================================================================
-- Stores individual slot sightings with change tracking

CREATE TABLE road_test_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Slot identity
  date DATE NOT NULL,
  time TEXT NOT NULL,              -- "08:00 AM" or "Stand-by"
  location TEXT NOT NULL,          -- Kapahulu, Kapolei, etc.
  slot_type TEXT NOT NULL,         -- 'regular' or 'standby'

  -- Booking info (for future use)
  button_name TEXT,
  button_value TEXT,               -- Seat count

  -- Change tracking (like slot_states pattern)
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Status tracking for notifications
  is_active BOOLEAN NOT NULL DEFAULT TRUE,  -- FALSE when slot disappears
  disappeared_at TIMESTAMPTZ,               -- When slot was last seen gone
  notified_appeared BOOLEAN DEFAULT FALSE,  -- Have we notified about appearance?
  notified_disappeared BOOLEAN DEFAULT FALSE, -- Have we notified about disappearance?

  -- Composite uniqueness
  CONSTRAINT road_test_slots_unique UNIQUE (date, time, location),
  CONSTRAINT road_test_slots_type_check CHECK (slot_type IN ('regular', 'standby'))
);

-- Index for "what's available" queries
CREATE INDEX idx_road_test_slots_available
  ON road_test_slots (date, location, last_seen DESC);

-- Index for active slots
CREATE INDEX idx_road_test_slots_active
  ON road_test_slots (is_active, date)
  WHERE is_active = TRUE;

-- Index for notification queries
CREATE INDEX idx_road_test_slots_unnotified_appeared
  ON road_test_slots (notified_appeared, first_seen)
  WHERE notified_appeared = FALSE AND is_active = TRUE;

CREATE INDEX idx_road_test_slots_unnotified_disappeared
  ON road_test_slots (notified_disappeared, disappeared_at)
  WHERE notified_disappeared = FALSE AND is_active = FALSE;

-- ============================================================================
-- PART 2: ROAD_TEST_SCANS TABLE
-- ============================================================================
-- Scan run metadata (for audit/debugging)

CREATE TABLE road_test_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ok BOOLEAN NOT NULL,
  reason TEXT,
  scan_duration_ms INTEGER,
  days_scanned INTEGER,
  total_slots_found INTEGER,
  slots_by_location JSONB,
  new_slots_count INTEGER DEFAULT 0,
  disappeared_slots_count INTEGER DEFAULT 0
);

-- Index for recent scans
CREATE INDEX idx_road_test_scans_recent ON road_test_scans (scanned_at DESC);

-- ============================================================================
-- PART 3: ROAD_TEST_NOTIFICATION_LOG TABLE
-- ============================================================================
-- Track notification history for deduplication and summaries

CREATE TABLE road_test_notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type TEXT NOT NULL,  -- 'instant', 'daily', 'weekly'
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  slots_notified JSONB,             -- Array of slot keys notified
  message_hash TEXT,                -- For exact deduplication

  CONSTRAINT road_test_notification_type_check
    CHECK (notification_type IN ('instant', 'daily', 'weekly'))
);

CREATE INDEX idx_road_test_notification_log_type
  ON road_test_notification_log (notification_type, sent_at DESC);

-- ============================================================================
-- PART 4: HELPER FUNCTIONS
-- ============================================================================

-- Function: Upsert road test slots with change tracking
-- Returns count of new and reactivated slots
CREATE OR REPLACE FUNCTION upsert_road_test_slots(
  p_slots JSONB
) RETURNS TABLE (
  new_count INTEGER,
  reactivated_count INTEGER,
  updated_count INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_count INTEGER := 0;
  v_reactivated_count INTEGER := 0;
  v_updated_count INTEGER := 0;
  v_slot JSONB;
  v_existing_id UUID;
  v_was_active BOOLEAN;
BEGIN
  FOR v_slot IN SELECT * FROM jsonb_array_elements(p_slots)
  LOOP
    -- Check if slot exists
    SELECT id, is_active INTO v_existing_id, v_was_active
    FROM road_test_slots
    WHERE date = (v_slot->>'date')::DATE
      AND time = v_slot->>'time'
      AND location = v_slot->>'location';

    IF v_existing_id IS NULL THEN
      -- New slot
      INSERT INTO road_test_slots (date, time, location, slot_type, button_name, button_value)
      VALUES (
        (v_slot->>'date')::DATE,
        v_slot->>'time',
        v_slot->>'location',
        v_slot->>'slot_type',
        v_slot->>'button_name',
        v_slot->>'button_value'
      );
      v_new_count := v_new_count + 1;
    ELSIF v_was_active = FALSE THEN
      -- Slot reappeared
      UPDATE road_test_slots
      SET is_active = TRUE,
          last_seen = NOW(),
          disappeared_at = NULL,
          notified_appeared = FALSE,
          notified_disappeared = FALSE,
          button_name = v_slot->>'button_name',
          button_value = v_slot->>'button_value'
      WHERE id = v_existing_id;
      v_reactivated_count := v_reactivated_count + 1;
    ELSE
      -- Update existing active slot
      UPDATE road_test_slots
      SET last_seen = NOW(),
          button_name = v_slot->>'button_name',
          button_value = v_slot->>'button_value'
      WHERE id = v_existing_id;
      v_updated_count := v_updated_count + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_new_count, v_reactivated_count, v_updated_count;
END;
$$;

-- Function: Mark disappeared slots
-- Marks slots not seen since cutoff as inactive
CREATE OR REPLACE FUNCTION mark_disappeared_road_test_slots(
  p_cutoff TIMESTAMPTZ
) RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE road_test_slots
  SET is_active = FALSE,
      disappeared_at = NOW(),
      notified_disappeared = FALSE
  WHERE is_active = TRUE
    AND last_seen < p_cutoff;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
