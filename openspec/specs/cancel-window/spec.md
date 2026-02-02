# Cancel Window Feature

**Status:** Dormant (code implemented, feature disabled)
**Last Updated:** 2026-02-01

---

## Overview

The cancel window gives users a brief period (default: 2 minutes) after booking to text "CANCEL" and undo their appointment. During this window, the bot stays on the DMV confirmation page and polls the database for cancel requests.

### User Experience

1. User receives booking confirmation SMS
2. Message includes: "Reply CANCEL within 2 minutes if you need to undo this"
3. If user texts CANCEL within window:
   - Bot clicks cancel button on DMV page
   - Booking fee is refunded
   - User transitions to `canceled` state
4. If window expires without cancel:
   - User transitions to `confirmed` state
   - Appointment is locked in

---

## Current State

**Feature is DISABLED.** The code exists but is skipped when `cancel_window_enabled = false`.

Location of implementation:
- `apps/booking-bot/booking-bot.ts` - `pollForCancelRequest()` and `clickCancelButton()`
- `packages/queue/config_service.ts` - `isCancelWindowEnabled()`, `getCancelWindowSeconds()`

---

## How to Enable

### Step 1: Database Migration

Add `cancel_requested` column to `queue_entries` table:

```sql
-- Migration: add_cancel_requested_column.sql
ALTER TABLE queue_entries
ADD COLUMN cancel_requested BOOLEAN DEFAULT FALSE;

-- Index for efficient polling
CREATE INDEX idx_queue_entries_cancel_requested
ON queue_entries(id)
WHERE cancel_requested = TRUE;
```

### Step 2: Update Admin Config

```sql
-- Enable the feature
INSERT INTO admin_config (key, value)
VALUES ('cancel_window_enabled', 'true')
ON CONFLICT (key) DO UPDATE SET value = 'true';

-- Set window duration (seconds)
INSERT INTO admin_config (key, value)
VALUES ('cancel_window_seconds', '120')
ON CONFLICT (key) DO UPDATE SET value = '120';
```

### Step 3: Implement SMS Webhook Handler

The SMS webhook (`/api/sms/incoming`) must handle CANCEL commands:

```typescript
// In SMS webhook handler
if (messageBody.toUpperCase().trim() === 'CANCEL') {
  // Find user's active queue entry in BOOKED state
  const { data: entry } = await supabase
    .from('queue_entries')
    .select('id, state, booked_at')
    .eq('user_id', userId)
    .eq('state', 'booked')
    .single();

  if (entry) {
    // Check if still within cancel window
    const bookedAt = new Date(entry.booked_at);
    const cancelWindowSeconds = await getCancelWindowSeconds();
    const windowEnd = new Date(bookedAt.getTime() + cancelWindowSeconds * 1000);

    if (new Date() < windowEnd) {
      // Set flag for bot to pick up
      await supabase
        .from('queue_entries')
        .update({ cancel_requested: true })
        .eq('id', entry.id);

      await sendSms(userId, phone, 'cancel_pending',
        'Cancel request received. Processing...',
        `${userId}_cancel_pending`);
    } else {
      await sendSms(userId, phone, 'cancel_expired',
        'Sorry, the cancel window has expired. Your appointment is confirmed.',
        `${userId}_cancel_expired`);
    }
  }
}
```

### Step 4: Verify DMV Cancel Button Selector

The `clickCancelButton()` function tries these selectors:

```typescript
const cancelSelectors = [
  'button:has-text("Cancel")',
  'a:has-text("Cancel")',
  '.cancel-button',
  '#cancelButton',
  '[data-action="cancel"]',
];
```

**Before enabling:** Manually book an appointment and inspect the confirmation page to find the actual cancel button selector. Update the list if needed.

---

## Configuration Reference

| Config Key | Type | Default | Description |
|------------|------|---------|-------------|
| `cancel_window_enabled` | boolean | `false` | Master toggle for feature |
| `cancel_window_seconds` | number | `120` | Duration of cancel window |

---

## How It Works (Technical)

### Polling Flow

```
User books appointment
        │
        ▼
┌───────────────────────┐
│ isCancelWindowEnabled │──── false ───► Immediately confirm
└───────────────────────┘
        │ true
        ▼
┌───────────────────────┐
│ pollForCancelRequest  │
│  (every 5 seconds)    │
└───────────────────────┘
        │
        ├── cancel_requested = true ──► clickCancelButton() ──► Refund ──► canceled
        │
        └── window expires ──► confirmed
```

### Database Polling Query

```typescript
const { data: entryData } = await supabase
  .from('queue_entries')
  .select('cancel_requested')
  .eq('id', queueEntryId)
  .single();

if (entryData?.cancel_requested) {
  // Process cancel
}
```

---

## Trade-offs

### Pros
- Better user experience (undo option)
- Reduces support requests for accidental bookings
- Premium feel

### Cons
- Bot holds browser open longer (resource usage)
- Adds complexity to booking flow
- Requires SMS webhook integration
- DMV cancel button selector may change

---

## Testing Checklist

Before enabling in production:

- [ ] `cancel_requested` column exists in database
- [ ] Admin config values are set
- [ ] SMS webhook handles CANCEL command
- [ ] DMV cancel button selector is verified
- [ ] Test: Book appointment, text CANCEL within window → appointment canceled, fee refunded
- [ ] Test: Book appointment, wait for window to expire → appointment confirmed
- [ ] Test: Text CANCEL after window expires → receive "window expired" message

---

## Rollback

To disable the feature:

```sql
UPDATE admin_config SET value = 'false' WHERE key = 'cancel_window_enabled';
```

The polling code will be skipped, and bookings will immediately confirm.
