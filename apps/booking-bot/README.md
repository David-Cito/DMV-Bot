# Booking Bot

Automated appointment booking bot for the DMV Queue System V2.

## Overview

The booking bot monitors for available appointment slots (detected by the monitoring bot) and attempts to book them for users in the active queue. It handles:

- Slot locking to prevent duplicate booking attempts
- Dual-user strategy (primary + backup) for payment failures
- Form automation via Playwright
- Cancel window polling (when enabled)
- Failure screenshots for debugging

## Environment Variables

```bash
# Required
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGc...
STRIPE_SECRET_KEY=sk_live_xxx
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_PHONE_NUMBER=+1808xxxxxxx

# Optional
CI=true  # Run headless (no browser UI)
```

## Running Locally

```bash
# Install dependencies
npm install

# Run the booking bot
npx ts-node apps/booking-bot/run-booking-bot.ts
```

## Configuration

Bot behavior can be configured via `admin_config` table:

| Key | Default | Description |
|-----|---------|-------------|
| `bot_max_retries` | 3 | Max retries for navigation steps |
| `bot_retry_delay_ms` | 1000 | Base delay between retries |
| `bot_navigation_timeout_ms` | 30000 | Page navigation timeout |
| `bot_element_timeout_ms` | 10000 | Element wait timeout |
| `cancel_window_enabled` | false | Enable cancel window feature |
| `cancel_window_seconds` | 120 | Cancel window duration |

## Architecture

```
run-booking-bot.ts       Entry point, runs on schedule
    │
    ▼
booking-bot.ts           Core booking logic
    │
    ├── bot-config.ts    Configuration loading
    │
    └── packages/queue/  Service layer
        ├── queue_service.ts
        ├── payment_service.ts
        └── notification_service.ts
```

## Booking Flow

1. **Fetch Slots** - Get recently detected open slots from monitoring bot
2. **Lock Slot** - Acquire lock to prevent duplicate attempts
3. **Select Users** - Atomically select top 2 eligible users (sets state to BOOKING)
4. **Navigate** - Playwright navigates to DMV site and selects slot
5. **Fill Form** - Enter user info (name, phone)
6. **Charge Payment** - Direct charge via Stripe (with retry logic)
7. **Submit** - Submit booking form
8. **Verify** - Check for confirmation message
9. **Notify** - Send SMS to user with appointment details
10. **Cancel Window** - (Optional) Poll for cancel requests
11. **Confirm** - Transition to CONFIRMED state

## Error Handling

| Error | Action |
|-------|--------|
| Navigation failure | Retry with fresh browser context |
| Payment declined | Move user to PAYMENT_ISSUE, try backup user |
| Submit failure | Refund charge, move user back to ACTIVE |
| All users fail | Release slot lock, log failure |

## Screenshots

Failure screenshots are uploaded to Supabase Storage:

```
booking-screenshots/
  failures/
    2026-02-01/
      {bot_id}_{error_code}_{location}_{timestamp}.png
```

## State Transitions

```
ACTIVE ──────► BOOKING ──────► BOOKED ──────► CONFIRMED
                  │
                  ├─► PAYMENT_ISSUE (payment failed)
                  │
                  └─► ACTIVE (released, slot unavailable)
```

## Runbook

### Bot Not Booking

1. Check `bot_runs` table for recent runs
2. Check `booking_attempts` table for failure reasons
3. Review failure screenshots in Supabase Storage
4. Check DMV site is accessible

### Users Stuck in BOOKING State

Run cleanup job:
```sql
SELECT * FROM reset_stuck_bookings(300);  -- 5 minute timeout
```

### Payment Failures

1. Check `failed_notifications` for SMS delivery issues
2. User should receive SMS with "Reply CARD to update"
3. Manual intervention: Update user's Stripe payment method

### DMV Site Changes

If DMV changes their HTML structure:
1. Check failure screenshots for visual changes
2. Update selectors in `booking-bot.ts`
3. Test with `CI=false` to see browser

## Testing

```bash
# Run tests
npm test -- --grep "booking-bot"

# Manual test (visible browser)
CI=false npx ts-node apps/booking-bot/run-booking-bot.ts
```
