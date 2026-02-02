-- Migration: Create atomic user selection function
-- This prevents race conditions when multiple bots try to select users simultaneously
-- Uses FOR UPDATE SKIP LOCKED to ensure each user is only selected by one bot

CREATE OR REPLACE FUNCTION select_users_for_booking_atomic(
  p_location_id UUID,
  p_slot_time TEXT,
  p_bot_id TEXT,
  p_slot_id TEXT,
  p_limit INT DEFAULT 2
)
RETURNS TABLE (
  user_id UUID,
  queue_entry_id UUID,
  tier TEXT,
  time_preference TEXT
) AS $$
DECLARE
  v_time_block TEXT;
BEGIN
  -- Determine time block from slot time (HH:MM:SS format)
  -- Morning: 8:00-10:45, Midday: 11:00-13:45, Afternoon: 14:00-15:45
  v_time_block := CASE
    WHEN p_slot_time >= '08:00:00' AND p_slot_time <= '10:45:00' THEN 'morning'
    WHEN p_slot_time >= '11:00:00' AND p_slot_time <= '13:45:00' THEN 'midday'
    WHEN p_slot_time >= '14:00:00' AND p_slot_time <= '15:45:00' THEN 'afternoon'
    ELSE NULL
  END;

  -- Atomically select and update users
  -- Priority tier first, then flexible, ordered by queue entry time
  -- FOR UPDATE SKIP LOCKED ensures no two bots can select the same user
  RETURN QUERY
  WITH selected AS (
    SELECT qe.id, qe.user_id, qe.tier, qe.time_preference
    FROM queue_entries qe
    WHERE qe.location_id = p_location_id
      AND qe.state = 'active'
      AND (
        qe.time_preference IS NULL
        OR qe.time_preference = v_time_block
      )
    ORDER BY
      (qe.tier = 'priority') DESC,  -- Priority tier first
      qe.queue_entered_at ASC        -- FIFO within tier
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE queue_entries
    SET
      state = 'booking',
      booking_bot_id = p_bot_id,
      booking_slot_id = p_slot_id,
      booking_started_at = NOW(),
      updated_at = NOW()
    WHERE id IN (SELECT id FROM selected)
    RETURNING id, user_id, tier, time_preference
  )
  SELECT
    updated.user_id,
    updated.id AS queue_entry_id,
    updated.tier,
    updated.time_preference
  FROM updated;
END;
$$ LANGUAGE plpgsql;

-- Function to release users back to active state
CREATE OR REPLACE FUNCTION release_users_from_booking_atomic(
  p_queue_entry_ids UUID[],
  p_reason TEXT
)
RETURNS INT AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE queue_entries
  SET
    state = 'active',
    booking_bot_id = NULL,
    booking_slot_id = NULL,
    booking_started_at = NULL,
    updated_at = NOW()
  WHERE id = ANY(p_queue_entry_ids)
    AND state = 'booking';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Log the release
  INSERT INTO user_state_history (user_id, queue_entry_id, from_state, to_state, trigger_type, trigger_details)
  SELECT
    user_id,
    id,
    'booking',
    'active',
    'bot_action',
    jsonb_build_object('reason', p_reason)
  FROM queue_entries
  WHERE id = ANY(p_queue_entry_ids);

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Add index for faster user selection queries
CREATE INDEX IF NOT EXISTS idx_queue_entries_booking_selection
ON queue_entries (location_id, state, tier, queue_entered_at)
WHERE state = 'active';
