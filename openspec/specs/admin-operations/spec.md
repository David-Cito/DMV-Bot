# Admin Operations

> **Last Updated:** February 2026
> **Access:** Supabase Dashboard → SQL Editor

---

## Overview

All admin operations are performed via SQL queries in the Supabase dashboard. Every manual action should be logged to the `admin_actions` table for audit trail.

---

## Admin Actions Log

Track all manual interventions:

```sql
CREATE TABLE admin_actions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type       TEXT NOT NULL,
  target_type       TEXT NOT NULL,  -- 'user', 'location', 'booking', 'system'
  target_id         UUID,
  details           JSONB NOT NULL,
  reason            TEXT,
  performed_by      TEXT NOT NULL,  -- Your name/identifier
  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_admin_actions_date ON admin_actions (created_at DESC);
CREATE INDEX idx_admin_actions_type ON admin_actions (action_type, created_at DESC);
```

### Logging Template

Always log your actions:

```sql
INSERT INTO admin_actions (action_type, target_type, target_id, details, reason, performed_by)
VALUES (
  'move_state',           -- action type
  'user',                 -- target type
  'usr_123...',           -- target id
  '{"from": "active", "to": "waiting"}',  -- details
  'User requested to pause',              -- reason
  'David'                 -- your name
);
```

---

## User Operations

### View User Details

```sql
-- Find user by phone
SELECT u.*, qe.*
FROM users u
LEFT JOIN queue_entries qe ON qe.user_id = u.id
WHERE u.phone = '+18081234567';

-- Find user by ID
SELECT u.*, qe.*, l.name as location_name
FROM users u
LEFT JOIN queue_entries qe ON qe.user_id = u.id
LEFT JOIN locations l ON l.id = qe.location_id
WHERE u.id = 'USER_ID_HERE';
```

### View User History

```sql
-- State change history
SELECT * FROM user_state_history
WHERE user_id = 'USER_ID_HERE'
ORDER BY created_at DESC
LIMIT 20;

-- Transaction history
SELECT * FROM transactions
WHERE user_id = 'USER_ID_HERE'
ORDER BY created_at DESC;

-- Booking attempts
SELECT * FROM booking_attempts
WHERE user_id = 'USER_ID_HERE'
ORDER BY created_at DESC;
```

### Move User to Different State

```sql
-- First, check current state
SELECT id, state, tier, location_id FROM queue_entries
WHERE user_id = 'USER_ID_HERE';

-- Move user (update the state)
UPDATE queue_entries
SET state = 'NEW_STATE_HERE',
    updated_at = NOW()
WHERE user_id = 'USER_ID_HERE'
RETURNING *;

-- Log the action
INSERT INTO admin_actions (action_type, target_type, target_id, details, reason, performed_by)
VALUES (
  'move_state',
  'user',
  'USER_ID_HERE',
  '{"from": "OLD_STATE", "to": "NEW_STATE_HERE"}',
  'REASON HERE',
  'YOUR_NAME'
);

-- Log to state history
INSERT INTO user_state_history (user_id, queue_entry_id, from_state, to_state, trigger_type, trigger_details)
SELECT user_id, id, 'OLD_STATE', 'NEW_STATE_HERE', 'admin', '{"admin": "YOUR_NAME", "reason": "REASON"}'
FROM queue_entries WHERE user_id = 'USER_ID_HERE';
```

**Valid states:** `waiting`, `invited`, `ready`, `active`, `booking`, `booked`, `payment_issue`, `confirmed`, `completed`, `canceled`, `expired`

### Reset User from BOOKING (Stuck)

```sql
-- If a user is stuck in BOOKING state
UPDATE queue_entries
SET state = 'active',
    booking_bot_id = NULL,
    booking_started_at = NULL,
    booking_slot_id = NULL,
    updated_at = NOW()
WHERE user_id = 'USER_ID_HERE'
  AND state = 'booking'
RETURNING *;

-- Log it
INSERT INTO admin_actions (action_type, target_type, target_id, details, reason, performed_by)
VALUES ('reset_booking', 'user', 'USER_ID_HERE', '{"from": "booking", "to": "active"}', 'Stuck in booking state', 'YOUR_NAME');
```

### Reset User from PAYMENT_ISSUE

```sql
-- Move back to active (after they claim card is fixed)
UPDATE queue_entries
SET state = 'active',
    updated_at = NOW()
WHERE user_id = 'USER_ID_HERE'
  AND state = 'payment_issue'
RETURNING *;

-- Log it
INSERT INTO admin_actions (action_type, target_type, target_id, details, reason, performed_by)
VALUES ('reset_payment_issue', 'user', 'USER_ID_HERE', '{}', 'User confirmed card is updated', 'YOUR_NAME');
```

### Move User Back to Waitlist

```sql
-- Return to waitlist (e.g., they want to pause)
UPDATE queue_entries
SET state = 'waiting',
    deposit_paid_at = NULL,
    queue_entered_at = NULL,
    updated_at = NOW()
WHERE user_id = 'USER_ID_HERE'
RETURNING *;

-- You may need to refund their deposit too (see Refunds section)
```

### Cancel User Completely

```sql
-- Mark as canceled
UPDATE queue_entries
SET state = 'canceled',
    updated_at = NOW()
WHERE user_id = 'USER_ID_HERE'
RETURNING *;

-- Log it
INSERT INTO admin_actions (action_type, target_type, target_id, details, reason, performed_by)
VALUES ('cancel_user', 'user', 'USER_ID_HERE', '{}', 'User requested cancellation', 'YOUR_NAME');
```

---

## Refund Operations

### Issue Deposit Refund

```sql
-- 1. Find the deposit transaction
SELECT * FROM transactions
WHERE user_id = 'USER_ID_HERE'
  AND type = 'deposit'
  AND status = 'completed'
ORDER BY created_at DESC
LIMIT 1;

-- 2. Record the refund in your database
INSERT INTO transactions (user_id, queue_entry_id, type, amount_cents, status, metadata)
SELECT
  user_id,
  id,
  'refund_deposit',
  (SELECT amount_cents FROM transactions WHERE user_id = 'USER_ID_HERE' AND type = 'deposit' ORDER BY created_at DESC LIMIT 1),
  'completed',
  '{"reason": "REASON", "admin": "YOUR_NAME"}'
FROM queue_entries
WHERE user_id = 'USER_ID_HERE'
RETURNING *;

-- 3. IMPORTANT: Actually issue refund in Stripe Dashboard
--    Go to Stripe → Payments → Find the charge → Refund

-- 4. Log admin action
INSERT INTO admin_actions (action_type, target_type, target_id, details, reason, performed_by)
VALUES ('refund_deposit', 'user', 'USER_ID_HERE', '{"amount_cents": AMOUNT}', 'REASON', 'YOUR_NAME');
```

### Issue Booking Fee Refund

```sql
-- 1. Find the booking and charge
SELECT b.*, t.stripe_payment_id, t.amount_cents
FROM bookings b
JOIN transactions t ON t.booking_id = b.id AND t.type = 'booking_fee'
WHERE b.user_id = 'USER_ID_HERE'
ORDER BY b.created_at DESC
LIMIT 1;

-- 2. Record the refund
INSERT INTO transactions (user_id, booking_id, type, amount_cents, status, metadata)
VALUES (
  'USER_ID_HERE',
  'BOOKING_ID_HERE',
  'refund_booking',
  AMOUNT_CENTS,
  'completed',
  '{"reason": "REASON", "admin": "YOUR_NAME"}'
);

-- 3. Update booking status if needed
UPDATE bookings
SET status = 'canceled'
WHERE id = 'BOOKING_ID_HERE';

-- 4. IMPORTANT: Actually issue refund in Stripe Dashboard

-- 5. Log admin action
INSERT INTO admin_actions (action_type, target_type, target_id, details, reason, performed_by)
VALUES ('refund_booking_fee', 'booking', 'BOOKING_ID_HERE', '{"amount_cents": AMOUNT}', 'REASON', 'YOUR_NAME');
```

---

## Queue Operations

### View Queue Status

```sql
-- Queue counts by location and state
SELECT
  l.name as location,
  qe.state,
  COUNT(*) as count
FROM queue_entries qe
JOIN locations l ON l.id = qe.location_id
GROUP BY l.name, qe.state
ORDER BY l.name, qe.state;

-- Active queue with positions
SELECT
  l.name as location,
  qe.tier,
  u.phone,
  qe.state,
  qe.created_at,
  ROW_NUMBER() OVER (PARTITION BY qe.location_id ORDER BY
    CASE WHEN qe.tier = 'priority' THEN 0 ELSE 1 END,
    qe.created_at
  ) as position
FROM queue_entries qe
JOIN users u ON u.id = qe.user_id
JOIN locations l ON l.id = qe.location_id
WHERE qe.state = 'active'
ORDER BY l.name, position;
```

### Adjust Queue Size

```sql
-- View current limits
SELECT name, code, queue_size_limit, pricing_tier FROM locations;

-- Change queue size for a location
UPDATE locations
SET queue_size_limit = NEW_SIZE
WHERE code = 'downtown'
RETURNING *;

-- Log it
INSERT INTO admin_actions (action_type, target_type, target_id, details, reason, performed_by)
VALUES ('change_queue_size', 'location', 'LOCATION_ID', '{"old": OLD_SIZE, "new": NEW_SIZE}', 'REASON', 'YOUR_NAME');
```

### Manually Move User Position

To move a user ahead in queue, you'd need to adjust their `created_at` or `queue_entered_at`:

```sql
-- Move user earlier in queue (use with caution)
UPDATE queue_entries
SET queue_entered_at = 'EARLIER_TIMESTAMP',
    updated_at = NOW()
WHERE user_id = 'USER_ID_HERE'
RETURNING *;

-- Log it
INSERT INTO admin_actions (action_type, target_type, target_id, details, reason, performed_by)
VALUES ('adjust_position', 'user', 'USER_ID_HERE', '{"new_queue_entered_at": "TIMESTAMP"}', 'REASON', 'YOUR_NAME');
```

---

## Location Operations

### Pause a Location

```sql
-- Disable location (no new signups, no bookings)
UPDATE locations
SET is_active = FALSE
WHERE code = 'downtown'
RETURNING *;

-- Log it
INSERT INTO admin_actions (action_type, target_type, target_id, details, reason, performed_by)
VALUES ('pause_location', 'location', 'LOCATION_ID', '{"location": "downtown"}', 'REASON', 'YOUR_NAME');
```

### Resume a Location

```sql
UPDATE locations
SET is_active = TRUE
WHERE code = 'downtown'
RETURNING *;

INSERT INTO admin_actions (action_type, target_type, target_id, details, reason, performed_by)
VALUES ('resume_location', 'location', 'LOCATION_ID', '{"location": "downtown"}', 'REASON', 'YOUR_NAME');
```

### Change Location Pricing Tier

```sql
UPDATE locations
SET pricing_tier = 'high_traffic'  -- or 'standard'
WHERE code = 'hawaii_kai'
RETURNING *;

INSERT INTO admin_actions (action_type, target_type, target_id, details, reason, performed_by)
VALUES ('change_pricing_tier', 'location', 'LOCATION_ID', '{"old": "standard", "new": "high_traffic"}', 'REASON', 'YOUR_NAME');
```

---

## Booking Operations

### View Recent Bookings

```sql
SELECT
  b.*,
  u.phone,
  l.name as location
FROM bookings b
JOIN users u ON u.id = b.user_id
JOIN locations l ON l.id = b.location_id
ORDER BY b.created_at DESC
LIMIT 20;
```

### Manually Mark as Booked

If you need to manually record a booking (e.g., you booked it yourself):

```sql
-- Create booking record
INSERT INTO bookings (user_id, queue_entry_id, location_id, appointment_date, appointment_time, status, booking_fee_cents)
VALUES (
  'USER_ID_HERE',
  'QUEUE_ENTRY_ID_HERE',
  'LOCATION_ID_HERE',
  '2026-03-15',
  '09:30:00',
  'confirmed',
  3500
)
RETURNING *;

-- Update user state
UPDATE queue_entries
SET state = 'booked',
    booked_at = NOW()
WHERE id = 'QUEUE_ENTRY_ID_HERE';

-- Log it
INSERT INTO admin_actions (action_type, target_type, target_id, details, reason, performed_by)
VALUES ('manual_booking', 'user', 'USER_ID_HERE', '{"date": "2026-03-15", "time": "09:30"}', 'Manual booking', 'YOUR_NAME');
```

### Cancel a Booking

```sql
-- Update booking status
UPDATE bookings
SET status = 'canceled'
WHERE id = 'BOOKING_ID_HERE'
RETURNING *;

-- Update user state (back to active or canceled)
UPDATE queue_entries
SET state = 'active',  -- or 'canceled' if they're leaving
    booked_at = NULL
WHERE id = 'QUEUE_ENTRY_ID_HERE';

-- Log it
INSERT INTO admin_actions (action_type, target_type, target_id, details, reason, performed_by)
VALUES ('cancel_booking', 'booking', 'BOOKING_ID_HERE', '{}', 'REASON', 'YOUR_NAME');
```

---

## System Configuration

### View All Config

```sql
SELECT * FROM admin_config ORDER BY key;
```

### Update Pricing

```sql
-- Update a pricing tier
UPDATE admin_config
SET value = '{"deposit_cents": 1000, "booking_fee_cents": 3000}',
    updated_at = NOW(),
    updated_by = 'YOUR_NAME'
WHERE key = 'pricing_standard_priority'
RETURNING *;

INSERT INTO admin_actions (action_type, target_type, target_id, details, reason, performed_by)
VALUES ('update_config', 'system', NULL, '{"key": "pricing_standard_priority", "new_value": {...}}', 'REASON', 'YOUR_NAME');
```

### Toggle Cancel Window

```sql
-- Disable cancel window
UPDATE admin_config
SET value = 'false',
    updated_at = NOW(),
    updated_by = 'YOUR_NAME'
WHERE key = 'cancel_window_enabled';

-- Enable cancel window
UPDATE admin_config
SET value = 'true',
    updated_at = NOW(),
    updated_by = 'YOUR_NAME'
WHERE key = 'cancel_window_enabled';
```

### Change Deposit Payment Window

```sql
UPDATE admin_config
SET value = '48',  -- hours
    updated_at = NOW(),
    updated_by = 'YOUR_NAME'
WHERE key = 'deposit_payment_window_hours';
```

---

## Troubleshooting Queries

### Find Stuck Users

```sql
-- Users stuck in BOOKING too long
SELECT u.phone, qe.*,
       EXTRACT(EPOCH FROM (NOW() - qe.booking_started_at))/60 as minutes_stuck
FROM queue_entries qe
JOIN users u ON u.id = qe.user_id
WHERE qe.state = 'booking'
  AND qe.booking_started_at < NOW() - INTERVAL '10 minutes';

-- Users stuck in INVITED too long
SELECT u.phone, qe.*,
       EXTRACT(EPOCH FROM (NOW() - qe.invited_at))/3600 as hours_since_invite
FROM queue_entries qe
JOIN users u ON u.id = qe.user_id
WHERE qe.state = 'invited'
  AND qe.invited_at < NOW() - INTERVAL '24 hours';
```

### Check Bot Health

```sql
-- Recent bot runs
SELECT * FROM bot_runs
ORDER BY started_at DESC
LIMIT 20;

-- Bot errors in last hour
SELECT * FROM bot_runs
WHERE status = 'error'
  AND started_at > NOW() - INTERVAL '1 hour';

-- Average booking duration
SELECT
  AVG(duration_ms) as avg_ms,
  MIN(duration_ms) as min_ms,
  MAX(duration_ms) as max_ms
FROM bot_runs
WHERE bot_type = 'booking'
  AND status = 'success'
  AND started_at > NOW() - INTERVAL '24 hours';
```

### Payment Issues

```sql
-- Recent payment failures
SELECT ba.*, u.phone
FROM booking_attempts ba
JOIN users u ON u.id = ba.user_id
WHERE ba.payment_result = 'declined'
ORDER BY ba.created_at DESC
LIMIT 20;

-- Users in payment_issue state
SELECT u.phone, qe.*, qe.updated_at as payment_issue_since
FROM queue_entries qe
JOIN users u ON u.id = qe.user_id
WHERE qe.state = 'payment_issue'
ORDER BY qe.updated_at;
```

### Slot Activity

```sql
-- Slots detected today
SELECT location_id, COUNT(*) as slots_found
FROM slot_states
WHERE first_seen::date = CURRENT_DATE
GROUP BY location_id;

-- Recent slot activity
SELECT * FROM slot_states
ORDER BY first_seen DESC
LIMIT 20;
```

---

## Emergency: Pause Everything

If something is very wrong and you need to stop all activity:

```sql
-- Disable all locations
UPDATE locations SET is_active = FALSE;

-- Log it
INSERT INTO admin_actions (action_type, target_type, target_id, details, reason, performed_by)
VALUES ('emergency_pause', 'system', NULL, '{"action": "disabled all locations"}', 'EMERGENCY', 'YOUR_NAME');
```

To resume:

```sql
UPDATE locations SET is_active = TRUE;

INSERT INTO admin_actions (action_type, target_type, target_id, details, reason, performed_by)
VALUES ('emergency_resume', 'system', NULL, '{"action": "enabled all locations"}', 'Resuming after emergency', 'YOUR_NAME');
```

---

## Admin Actions Reference

| Action Type | Target Type | Description |
|-------------|-------------|-------------|
| `move_state` | user | Change user's queue state |
| `reset_booking` | user | Reset stuck BOOKING state |
| `reset_payment_issue` | user | Reset PAYMENT_ISSUE state |
| `cancel_user` | user | Cancel user's queue entry |
| `adjust_position` | user | Change queue position |
| `refund_deposit` | user | Refund deposit |
| `refund_booking_fee` | booking | Refund booking fee |
| `manual_booking` | user | Manually record a booking |
| `cancel_booking` | booking | Cancel a booking |
| `pause_location` | location | Disable a location |
| `resume_location` | location | Enable a location |
| `change_queue_size` | location | Adjust queue limit |
| `change_pricing_tier` | location | Change pricing tier |
| `update_config` | system | Change system config |
| `emergency_pause` | system | Pause everything |
| `emergency_resume` | system | Resume after emergency |

---

## Related Specs

- [Database](../database/spec.md) - Table schemas
- [User States](../user-states/spec.md) - Valid states and transitions
- [Payment & Pricing](../payment-pricing/spec.md) - Refund conditions
