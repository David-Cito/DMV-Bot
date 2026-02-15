-- Migration: Add notification deduplication flags to slot_states
-- This prevents duplicate "Slot Appeared" notifications when slots reappear
-- after disappearing temporarily (e.g., website glitch, brief booking).
--
-- Pattern adopted from road_test_slots (see 20260204_road_test_slots.sql)

-- ============================================================================
-- PART 1: ADD COLUMNS TO SLOT_STATES
-- ============================================================================

-- Add is_active flag to track if slot is currently available
ALTER TABLE slot_states
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Add notification tracking flags
ALTER TABLE slot_states
ADD COLUMN IF NOT EXISTS notified_appeared BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE slot_states
ADD COLUMN IF NOT EXISTS notified_disappeared BOOLEAN NOT NULL DEFAULT FALSE;

-- Add timestamp for when slot disappeared
ALTER TABLE slot_states
ADD COLUMN IF NOT EXISTS disappeared_at TIMESTAMPTZ;

-- ============================================================================
-- PART 2: CREATE INDEXES FOR NOTIFICATION QUERIES
-- ============================================================================

-- Index for active slots
CREATE INDEX IF NOT EXISTS idx_slot_states_active
  ON slot_states (is_active, date)
  WHERE is_active = TRUE;

-- Index for unnotified appeared slots
CREATE INDEX IF NOT EXISTS idx_slot_states_unnotified_appeared
  ON slot_states (notified_appeared, first_seen)
  WHERE notified_appeared = FALSE AND is_active = TRUE;

-- Index for unnotified disappeared slots
CREATE INDEX IF NOT EXISTS idx_slot_states_unnotified_disappeared
  ON slot_states (notified_disappeared, disappeared_at)
  WHERE notified_disappeared = FALSE AND is_active = FALSE;

-- ============================================================================
-- PART 3: UPDATE UPSERT_SLOT_STATES FUNCTION
-- ============================================================================
-- When a slot reappears (was inactive, now active again):
-- - Set is_active = TRUE
-- - Reset notified_appeared = FALSE (so we can notify about reappearance)
-- - Clear disappeared_at
-- - Reset notified_disappeared = FALSE

CREATE OR REPLACE FUNCTION upsert_slot_states(rows jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO slot_states (location_id, date, time, first_seen, last_seen, is_active, notified_appeared, notified_disappeared, disappeared_at)
  SELECT
    location_id,
    date,
    time,
    first_seen,
    last_seen,
    TRUE,   -- is_active
    FALSE,  -- notified_appeared (new slots need notification)
    FALSE,  -- notified_disappeared
    NULL    -- disappeared_at
  FROM jsonb_to_recordset(rows)
    AS x(location_id uuid, date date, time text, first_seen timestamptz, last_seen timestamptz)
  ON CONFLICT (location_id, date, time)
  DO UPDATE SET
    last_seen = excluded.last_seen,
    first_seen = LEAST(slot_states.first_seen, excluded.first_seen),
    -- If slot was inactive and is now being seen again, reset notification flags
    is_active = TRUE,
    notified_appeared = CASE
      WHEN slot_states.is_active = FALSE THEN FALSE  -- Reappeared: needs re-notification
      ELSE slot_states.notified_appeared             -- Still active: keep flag
    END,
    notified_disappeared = CASE
      WHEN slot_states.is_active = FALSE THEN FALSE  -- Reset when reactivated
      ELSE slot_states.notified_disappeared
    END,
    disappeared_at = CASE
      WHEN slot_states.is_active = FALSE THEN NULL   -- Clear when reactivated
      ELSE slot_states.disappeared_at
    END;
END;
$$;

-- ============================================================================
-- PART 4: CREATE MARK_DISAPPEARED_SLOT_STATES FUNCTION
-- ============================================================================
-- Marks slots not seen since cutoff as inactive
-- Sets notified_disappeared = FALSE so we can send disappearance notifications

CREATE OR REPLACE FUNCTION mark_disappeared_slot_states(
  p_cutoff TIMESTAMPTZ
) RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE slot_states
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
-- PART 5: INITIALIZE EXISTING DATA
-- ============================================================================
-- Mark existing slots as notified to avoid spam on first run
-- Slots from latest scan are active, others are inactive

DO $$
DECLARE
  v_latest_scan TIMESTAMPTZ;
BEGIN
  -- Find the latest scan time
  SELECT MAX(last_seen) INTO v_latest_scan FROM slot_states;

  IF v_latest_scan IS NOT NULL THEN
    -- Mark slots from latest scan as active and already notified
    UPDATE slot_states
    SET is_active = TRUE,
        notified_appeared = TRUE,
        notified_disappeared = FALSE,
        disappeared_at = NULL
    WHERE last_seen = v_latest_scan;

    -- Mark older slots as inactive and already notified
    UPDATE slot_states
    SET is_active = FALSE,
        notified_appeared = TRUE,
        notified_disappeared = TRUE,
        disappeared_at = last_seen
    WHERE last_seen < v_latest_scan;
  END IF;
END;
$$;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
