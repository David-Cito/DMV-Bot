# Analytics & Operations

> **Last Updated:** February 2026

---

## Infrastructure

### GitHub Actions (Free Tier)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    GITHUB ACTIONS SCHEDULE                                  │
└─────────────────────────────────────────────────────────────────────────────┘

MONITORING BOT
──────────────
• Runs every 2 minutes (even minutes: :00, :02, :04...)
• Scans all 4 DMV locations
• Writes new slots to slot_states table
• Logs run to bot_runs table


BOOKING BOT
───────────
• Runs every 1 minute (odd minutes: :01, :03, :05...)
• Polls for new slots
• Matches against queue
• Attempts bookings
• Logs all attempts


CLEANUP JOB
───────────
• Runs every 10 minutes
• Resets stuck BOOKING states
• Expires old invites (>24h)
• Logs system events


DAILY SUMMARY
─────────────
• Runs at midnight HST
• Computes daily_metrics
• Checks for alerts
```

### Cost Analysis

| Service | Free Tier | Expected Usage | Cost |
|---------|-----------|----------------|------|
| **GitHub Actions** | 2,000 min/month (private) | ~1,500 min/month | $0 |
| **Supabase** | 500MB database | ~100MB | $0 |
| **Twilio** | Pay per SMS | ~$0.008/msg | ~$50/month at scale |
| **Stripe** | 2.9% + $0.30 | Per transaction | Only when you earn |

---

## Analytics Phase 1: Logging

Log everything from launch. These tables capture all activity:

### What to Log

| Table | What It Captures |
|-------|------------------|
| `bot_runs` | Every bot execution (start, end, status, stats) |
| `booking_attempts` | Every booking attempt per user |
| `user_state_history` | Every state change with trigger |
| `transactions` | Every payment and refund |
| `system_events` | Errors, cleanups, alerts |

### Logging in Code

```javascript
// Start of bot run
const run = await db.bot_runs.insert({
  bot_type: 'booking',
  started_at: new Date(),
});

// ... do work ...

// End of bot run
await db.bot_runs.update(run.id, {
  ended_at: new Date(),
  status: 'success',
  slots_found: 3,
  duration_ms: Date.now() - startTime,
});
```

```javascript
// State change
await db.user_state_history.insert({
  user_id: user.id,
  queue_entry_id: entry.id,
  from_state: 'active',
  to_state: 'booking',
  trigger_type: 'bot_action',
  trigger_details: { bot_run_id: run.id, slot_id: slot.id },
});
```

---

## Analytics Phase 2: Summaries & Alerts

### Daily Summary Job

Runs at midnight, computes metrics for previous day:

```sql
INSERT INTO daily_metrics (date, location_id, slots_detected, slots_booked, ...)
SELECT
  CURRENT_DATE - 1 as date,
  location_id,
  COUNT(DISTINCT slot_id) as slots_detected,
  COUNT(DISTINCT slot_id) FILTER (WHERE booked = true) as slots_booked,
  ...
FROM slot_states
WHERE first_seen::date = CURRENT_DATE - 1
GROUP BY location_id;
```

### Alert Queries

Run hourly to detect issues:

**Payment failure rate > 5%:**
```sql
SELECT
  COUNT(*) FILTER (WHERE payment_result = 'declined') as failures,
  COUNT(*) FILTER (WHERE payment_attempted = true) as total,
  ROUND(
    COUNT(*) FILTER (WHERE payment_result = 'declined')::decimal /
    NULLIF(COUNT(*) FILTER (WHERE payment_attempted = true), 0) * 100, 2
  ) as failure_rate
FROM booking_attempts
WHERE created_at > NOW() - INTERVAL '1 hour';
-- Alert if failure_rate > 5
```

**Stuck bookings:**
```sql
SELECT COUNT(*) as stuck_users
FROM queue_entries
WHERE state = 'BOOKING'
  AND booking_started_at < NOW() - INTERVAL '10 minutes';
-- Alert if stuck_users > 0
```

**Bot errors:**
```sql
SELECT
  bot_type,
  COUNT(*) FILTER (WHERE status = 'error') as errors,
  COUNT(*) as total
FROM bot_runs
WHERE started_at > NOW() - INTERVAL '1 hour'
GROUP BY bot_type;
-- Alert if error rate > 10%
```

**No slots detected:**
```sql
SELECT
  COUNT(*) as runs,
  SUM(slots_found) as total_slots
FROM bot_runs
WHERE bot_type = 'monitor'
  AND started_at > NOW() - INTERVAL '1 hour';
-- Alert if runs > 0 but total_slots = 0
```

### Key Metrics to Track

| Metric | Why It Matters |
|--------|----------------|
| Booking success rate | Is the system working? |
| Payment failure rate | Are users having card issues? |
| Time to booking | Are users waiting too long? |
| Funnel conversion | Where are users dropping off? |
| Queue depth vs slots | Is supply/demand balanced? |
| Revenue per location | Which locations are most valuable? |

---

## Runtime Configuration

All settings can be changed while the system is live.

### Per-Location Settings

| Setting | Description | How to Change |
|---------|-------------|---------------|
| `queue_size_limit` | Max users in queue | Update `locations` table |
| `pricing_tier` | standard or high_traffic | Update `locations` table |
| `is_active` | Enable/disable location | Update `locations` table |

### System-Wide Settings

| Setting | Description | Default | How to Change |
|---------|-------------|---------|---------------|
| `pricing_*` | All pricing tiers | See pricing spec | Update `admin_config` |
| `deposit_payment_window_hours` | Time to pay deposit | 24 | Update `admin_config` |
| `cancel_window_enabled` | Toggle cancel window | true | Update `admin_config` |
| `cancel_window_seconds` | Cancel window duration | 600 | Update `admin_config` |
| `payment_issue_timeout_days` | Time to fix card | 7 | Update `admin_config` |

### Changing Config

```sql
-- Change queue size for Downtown
UPDATE locations SET queue_size_limit = 10 WHERE code = 'downtown';

-- Disable cancel window
UPDATE admin_config SET value = 'false' WHERE key = 'cancel_window_enabled';

-- Adjust pricing
UPDATE admin_config
SET value = '{"deposit_cents": 1500, "booking_fee_cents": 4000}'
WHERE key = 'pricing_high_traffic_priority';
```

---

## Edge Cases & Error Handling

### Payment Failures

```
CARD DECLINED (before submit):
──────────────────────────────
• Don't click submit
• User → PAYMENT_ISSUE state
• Try backup user if available
• Text user: "Card failed, update payment"
• Queue position preserved


CARD DECLINED (one strike policy):
──────────────────────────────────
• After 1 failure, user must update card
• User paused until card updated
• Prevents repeated failed attempts
```

### Booking Failures

```
SUBMIT FAILS (after charge):
────────────────────────────
• Refund the charge (~$1.30 fee lost)
• User stays in queue
• Text user: "Technical issue, refunded, still in queue"
• No confusing DMV message (we charged before submit)


SLOT TAKEN (during navigation):
───────────────────────────────
• Release locks
• Users return to ACTIVE state
• No charge attempted
• Will match on next slot
```

### Stuck States

```
USER STUCK IN BOOKING (bot crashed):
────────────────────────────────────
• Cleanup job runs every 10 min
• Resets users in BOOKING > 10 minutes
• Returns them to ACTIVE state
• Logs event for investigation


USER STUCK IN INVITED (didn't pay):
───────────────────────────────────
• After 24 hours, invite expires
• User returns to WAITING state
• Or moves to EXPIRED after repeated timeouts
```

### Cancel Window

```
USER REQUESTS CANCEL (within window):
─────────────────────────────────────
• Bot is holding confirmation page
• Click "Cancel Appointment" button
• Refund booking fee
• User gets: "Appointment canceled, fee refunded"


CANCEL WINDOW EXPIRES:
──────────────────────
• Bot navigates away from confirmation page
• User → CONFIRMED state
• No more cancellation through our system
• Appointment is locked
```

---

## Cleanup Jobs

### Stuck Booking Reset

```sql
-- Run every 10 minutes
UPDATE queue_entries
SET state = 'ACTIVE',
    booking_bot_id = NULL,
    booking_started_at = NULL,
    booking_slot_id = NULL
WHERE state = 'BOOKING'
  AND booking_started_at < NOW() - INTERVAL '10 minutes'
RETURNING *;

-- Log each reset
INSERT INTO system_events (event_type, user_id, details)
SELECT 'booking_timeout_reset', id, jsonb_build_object(
  'booking_bot_id', booking_bot_id,
  'booking_started_at', booking_started_at
)
FROM queue_entries
WHERE state = 'BOOKING'
  AND booking_started_at < NOW() - INTERVAL '10 minutes';
```

### Expired Invites

```sql
-- Run every hour
UPDATE queue_entries
SET state = 'WAITING',
    invited_at = NULL
WHERE state = 'INVITED'
  AND invited_at < NOW() - INTERVAL '24 hours'
RETURNING *;
```

### Expired Slot Locks

```sql
-- Run every 5 minutes
DELETE FROM slot_locks
WHERE expires_at < NOW();
```

### Payment Issue Timeout

```sql
-- Run daily
UPDATE queue_entries
SET state = 'EXPIRED'
WHERE state = 'PAYMENT_ISSUE'
  AND updated_at < NOW() - INTERVAL '7 days'
RETURNING *;
```

---

## Next Steps

1. **Remove old queue system code** - Clean slate for new implementation
2. **Create database migration** - New tables per database spec
3. **Implement state machine** - Core queue_entries logic
4. **Build Twilio conversation flow** - SMS signup and notifications
5. **Integrate Stripe** - Deposits and booking fees
6. **Update booking bot** - Dual-user flow with direct charge
7. **Add analytics logging** - Instrument all operations
8. **Deploy and test** - Gradual rollout

---

## Related Specs

- [Database](../database/spec.md) - Table schemas
- [System Overview](../system-overview/spec.md) - Architecture
- [Booking Flow](../booking-flow/spec.md) - What gets logged during booking
