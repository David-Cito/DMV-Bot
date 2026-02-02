# Queue Mechanics

> **Last Updated:** February 2026

---

## Eligibility & Priority

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    SLOT MATCHING: TIERED FIFO                               │
└─────────────────────────────────────────────────────────────────────────────┘

When a slot opens:

1. Check PRIORITY tier users first
   • Filter: location matches, time preference matches (or any), state = ACTIVE
   • Order: FIFO by queue join time
   • First match gets the booking attempt

2. If no Priority matches, check FLEXIBLE tier
   • Same filters and ordering
   • First match gets the booking attempt

3. If no one matches
   • Slot is skipped (no eligible users)
   • Will be picked up by next bot run if still available
```

### Time Preference: Hard Filter

- If user selected "Morning only", they ONLY match morning slots
- If user selected "Any time" (default), they match all slots
- No soft preferences - it's match or skip

### Time Blocks

DMV appointments run 8:00am - 3:45pm, every 15 minutes.

| Block | Hours | Slots |
|-------|-------|-------|
| Morning | 8:00am - 10:45am | 12 slots |
| Midday | 11:00am - 1:45pm | 12 slots |
| Afternoon | 2:00pm - 3:45pm | 8 slots |

---

## Queue Sizing

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    QUEUE SIZE MANAGEMENT                                    │
└─────────────────────────────────────────────────────────────────────────────┘

PER-LOCATION SETTINGS (runtime adjustable):
───────────────────────────────────────────

    Location        Queue Size    Pre-Queue Size (queue ÷ 2)
    ──────────────────────────────────────────────────────────
    Downtown            8                 4
    Hawaii Kai          6                 3
    Pearlridge          8                 4
    Windward City       4                 2
```

### Pre-Queue Size Formula

```
pre_queue_size = queue_size ÷ 2
```

This ensures there are always users ready to fill queue spots when they open.

### Adjustment Triggers

| Condition | Action |
|-----------|--------|
| Slots appearing faster than bookings | Increase queue size |
| Users waiting too long (>2 weeks) | Decrease queue size |
| Manual adjustment needed | Update `locations.queue_size_limit` |

---

## Transfer Priority (Pre-Queue → Queue)

When a queue spot opens, select from pre-queue using the same eligibility rules:

1. Priority tier first (FIFO within tier)
2. Then Flexible tier (FIFO within tier)

---

## Concurrency: Dual Locking

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PREVENTING RACE CONDITIONS                               │
└─────────────────────────────────────────────────────────────────────────────┘

PROBLEM: Multiple bots might grab the same users simultaneously.

SOLUTION: Lock both SLOT and USERS.
```

### Slot Lock

- Lock key: `slot_${location}_${date}_${time}`
- Prevents multiple bots from booking same slot
- Released after booking attempt completes

### User Lock (via state)

- When bot selects users: state changes to `BOOKING`
- Other bots only select users WHERE `state = 'ACTIVE'`
- Users in `BOOKING` state are automatically skipped
- No separate lock table needed - state IS the lock

### Atomic User Selection

```sql
-- Bot selecting and locking users atomically

WITH eligible_users AS (
  SELECT id, tier, created_at
  FROM queue_entries
  WHERE location_id = $location_id
    AND state = 'ACTIVE'
    AND (time_preference IS NULL OR time_preference = $slot_time_block)
  ORDER BY
    CASE WHEN tier = 'priority' THEN 0 ELSE 1 END,
    created_at ASC
  LIMIT 2
  FOR UPDATE SKIP LOCKED  -- Prevents race conditions
)
UPDATE queue_entries
SET state = 'BOOKING',
    booking_bot_id = $bot_run_id,
    booking_started_at = NOW(),
    booking_slot_id = $slot_id
WHERE id IN (SELECT id FROM eligible_users)
RETURNING *;

-- Returns the users that were successfully locked
-- If another bot grabbed them first, returns fewer/no rows
```

---

## Crash Recovery

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    STUCK BOOKING CLEANUP                                    │
└─────────────────────────────────────────────────────────────────────────────┘

PROBLEM:
────────
Bot sets User to BOOKING state
Bot crashes
User stuck in BOOKING forever


SOLUTION:
─────────
Cleanup job runs every 5-10 minutes:

UPDATE queue_entries
SET state = 'ACTIVE',
    booking_bot_id = NULL,
    booking_started_at = NULL
WHERE state = 'BOOKING'
  AND booking_started_at < NOW() - INTERVAL '10 minutes';
```

### Why 10 Minutes?

- Normal booking takes <1 minute
- Even with retries and delays: <3 minutes
- 10 minutes means something definitely went wrong
- Safe to reset back to ACTIVE

### Logging

When cleanup resets a user, log it for investigation:

```sql
INSERT INTO system_events (event_type, user_id, details, created_at)
VALUES ('booking_timeout_reset', $user_id,
        '{"bot_id": "...", "started_at": "..."}', NOW());
```

---

## Related Specs

- [User States](../user-states/spec.md) - State definitions and transitions
- [Booking Flow](../booking-flow/spec.md) - How bookings are processed
- [Database](../database/spec.md) - Table schemas and indexes
