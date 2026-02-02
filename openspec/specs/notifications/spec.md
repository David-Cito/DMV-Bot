# Notifications

> **Last Updated:** February 2026

---

## SMS-First Interface

All user interaction happens via SMS through Twilio. No web interface.

### Why SMS?

- Universal (no app download needed)
- Instant delivery
- Works on any phone
- Natural conversational interface
- High open rates

---

## Twilio Setup

| Component | Purpose |
|-----------|---------|
| Phone Number | Dedicated number for the service |
| Webhooks | Receive incoming SMS |
| Messaging API | Send outgoing SMS |

---

## Conversation Flow Example

```
USER                                    SYSTEM
────                                    ──────

"Hi"
        ───────────────────────────────▶
                                        "Welcome to DMV Bot!

                                         What do you need help with?

                                         1. License/ID Renewal
                                         2. License/ID Duplicate
                                         3. Instruction Permit
                                         4. Out of State Transfer
                                         5. Motor Vehicle Services
                                         6. Something else"
        ◀───────────────────────────────
"1"
        ───────────────────────────────▶
                                        "Great! We can help with renewals.

                                         Which location do you need?
                                         1. Downtown
                                         2. Hawaii Kai
                                         3. Pearlridge
                                         4. Windward City"
        ◀───────────────────────────────
"1"
        ───────────────────────────────▶
                                        "Downtown - got it!

                                         How urgent is your appointment?

                                         ⚡ PRIORITY - Within 2 weeks ($10 deposit)
                                         🌊 FLEXIBLE - 1-4 weeks ($5 deposit)

                                         Reply PRIORITY or FLEXIBLE"
        ◀───────────────────────────────
"flexible"
        ───────────────────────────────▶
                                        "You're on the waitlist! 🎉

                                         📍 Downtown
                                         🌊 Flexible (1-4 weeks)
                                         💰 $5 deposit when invited

                                         We'll text you when a queue spot opens.

                                         ⚠️ Need a specific time of day?
                                         Reply TIME to set (not recommended -
                                         reduces available appointments)"
        ◀───────────────────────────────
```

---

## Message Types

### Signup Flow

| Message | Trigger | Content |
|---------|---------|---------|
| **Welcome** | User texts in | Service selection prompt |
| **Service Confirmed** | User selects renewal | Location selection prompt |
| **Service Unsupported** | User selects other service | Vote recorded, notify opt-in prompt |
| **Location Confirmed** | User selects location | Tier selection prompt |
| **Tier Confirmed** | User selects tier | Waitlist confirmation |
| **Time Preference** | User replies TIME | Time selection (with warning) |

### Queue Flow

| Message | Trigger | Content |
|---------|---------|---------|
| **Invite** | Spot available | Pay deposit link, 24h deadline |
| **Deposit Reminder** | 12h before deadline | Reminder to pay |
| **Deposit Confirmed** | Payment successful | Pre-queue confirmation |
| **Queue Entry** | Moved to queue | Now actively matching |

### Booking Flow

| Message | Trigger | Content |
|---------|---------|---------|
| **Booked** | Booking successful | Appointment details, cancel option |
| **Booking Confirmed** | Cancel window expires | Final confirmation |

### Payment Issues

| Message | Trigger | Content |
|---------|---------|---------|
| **Payment Failed** | Card declined | Update card instructions |
| **Card Updated** | New card validated | Back in queue confirmation |

### Cancellation

| Message | Trigger | Content |
|---------|---------|---------|
| **Canceled** | User cancels | Confirmation, refund info |
| **Expired** | Timeout | What happened, options |

---

## Message Templates

### Invite Message

```
🎉 Great news!

A queue spot just opened at Downtown.

Pay your $5 deposit to secure your spot:
[PAYMENT_LINK]

⏰ You have 24 hours to pay, or your spot goes to the next person.

Reply SKIP to stay on the waitlist instead.
```

### Booked Message

```
✅ Appointment Booked!

📍 Downtown
📅 March 15, 2026
🕐 9:30 AM

[If cancel window enabled:]
⚠️ Reply CANCEL within 10 minutes if you need to undo this.
After that, the appointment is locked.

[If cancel window disabled:]
Your appointment is confirmed! See you there.
```

### Payment Failed Message

```
⚠️ Payment Failed

Your card couldn't be charged for a Downtown appointment.

You're paused until you update your payment method.
Your queue spot (#3) is saved.

Reply CARD to update your payment method.
```

### Cancel Confirmed Message

```
✅ Appointment Canceled

Your Downtown appointment for March 15 has been canceled.

💰 Your $35 booking fee will be refunded within 5-10 business days.

Want to try again? Reply START to rejoin the waitlist.
```

---

## Conversation State Management

Each user has a conversation state tracked in the database:

```sql
-- Conversation state stored on user or separate table
conversation_state TEXT  -- 'idle', 'selecting_service', 'selecting_location', 'selecting_tier', etc.
conversation_data JSONB  -- Temporary data during multi-step flows
```

### State Machine

```
IDLE
  │
  │ user texts anything
  ▼
SELECTING_SERVICE
  │
  ├─── selects renewal (supported)
  │         │
  │         ▼
  │    SELECTING_LOCATION
  │         │
  │         │ user selects location
  │         ▼
  │    SELECTING_TIER
  │         │
  │         │ user selects tier
  │         ▼
  │    IDLE (user now on waitlist)
  │
  └─── selects other service (unsupported)
            │
            ▼
       ASKING_NOTIFY_PREFERENCE
            │
            ▼
       IDLE (vote recorded)
```

See [Service Selection](../service-selection/spec.md) for full service selection flow.

---

## Commands

Users can text these commands at any time:

| Command | Action |
|---------|--------|
| `STATUS` | Check current position and state |
| `CANCEL` | Cancel and request refund |
| `CARD` | Update payment method |
| `HELP` | Show available commands |
| `TIME` | Set/change time preference |

---

## Message Deduplication

Prevent sending duplicate messages:

```sql
-- Check before sending
SELECT * FROM message_log
WHERE user_id = $user_id
  AND dedupe_key = $dedupe_key;

-- If exists, skip sending
-- If not, send and log:
INSERT INTO message_log (user_id, message_type, dedupe_key, sent_at)
VALUES ($user_id, $type, $dedupe_key, NOW());
```

### Dedupe Key Format

```
{user_id}_{message_type}_{context_id}

Examples:
- usr_123_invite_1          (first invite)
- usr_123_booked_slt_456    (booked for slot 456)
- usr_123_payment_failed_2  (second payment failure)
```

---

## Notification Timing Rules

1. **Don't notify mid-attempt** - Wait until booking outcome is known
2. **Batch related messages** - Don't spam with multiple texts
3. **Respect quiet hours** - Consider time zone (Hawaii = HST)
4. **Immediate for time-sensitive** - Invites, bookings, payment issues

---

## Related Specs

- [Service Selection](../service-selection/spec.md) - First step in conversation flow
- [User States](../user-states/spec.md) - When notifications are triggered
- [Booking Flow](../booking-flow/spec.md) - Booking notification timing
- [Payment & Pricing](../payment-pricing/spec.md) - Payment-related notifications
