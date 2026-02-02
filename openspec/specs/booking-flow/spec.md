# Booking Flow

> **Last Updated:** February 2026

---

## Overview

The booking bot uses a **dual-user strategy**: select two eligible users before navigating to DMV. If the primary user's card fails, immediately swap to the backup user without restarting the bot.

---

## Dual-User Booking Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    BOOKING WITH BACKUP USER                                 │
└─────────────────────────────────────────────────────────────────────────────┘

    SLOT DETECTED
           │
           ▼
    ┌─────────────────────────────────────┐
    │  1. Acquire SLOT lock               │
    └──────────────┬──────────────────────┘
                   │
                   ▼
    ┌─────────────────────────────────────┐
    │  2. Select TOP 2 eligible users     │
    │     (atomically set state=BOOKING)  │
    │                                     │
    │     User A = first in priority      │
    │     User B = backup                 │
    └──────────────┬──────────────────────┘
                   │
                   ▼
    ┌─────────────────────────────────────┐
    │  3. Navigate to DMV, click slot     │
    │     (3-minute hold timer starts)    │
    └──────────────┬──────────────────────┘
                   │
                   ▼
    ┌─────────────────────────────────────┐
    │  4. Fill User A's info (3 fields)   │
    └──────────────┬──────────────────────┘
                   │
                   ▼
    ┌─────────────────────────────────────┐
    │  5. CHARGE User A (direct charge)   │
    └──────────────┬──────────────────────┘
                   │
          ┌────────┴────────┐
          ▼                 ▼
    CHARGE FAILS       CHARGE SUCCEEDS
          │                 │
          │                 ▼
          │            CLICK SUBMIT ───▶ DONE (User A booked)
          │
          ▼
    ┌─────────────────────────────────────┐
    │  User A → PAYMENT_ISSUE state       │
    └──────────────┬──────────────────────┘
                   │
                   │  Is there a User B?
          ┌────────┴────────┐
          ▼                 ▼
       NO USER B        USER B EXISTS
          │                 │
          ▼                 ▼
    Abandon, notify    Clear form, fill User B's info
    User A                  │
                            ▼
                      CHARGE User B
                            │
                   ┌────────┴────────┐
                   ▼                 ▼
             CHARGE FAILS       CHARGE SUCCEEDS
                   │                 │
                   ▼                 ▼
             Both users →       CLICK SUBMIT
             PAYMENT_ISSUE           │
             Abandon, notify    DONE (User B booked)
             both               Notify User A (card failed)
                                Notify User B (booked!)
```

---

## DMV Site Constraints

| Constraint | Value |
|------------|-------|
| Hold time after clicking slot | 3 minutes |
| Form fields to fill | 3 text boxes |
| Submit button | Single click |

---

## Timing Budget

```
    0:00  Click slot (3-min DMV hold starts)
    0:10  Fill User A's info
    0:13  Charge User A
    0:14  Charge FAILS
    0:15  Mark User A as PAYMENT_ISSUE
    0:25  Clear form, fill User B's info
    0:28  Charge User B
    0:29  Charge SUCCEEDS
    0:30  Click submit
    ─────────────────────────────────────────
    TOTAL: 30 seconds
    BUFFER REMAINING: 2 minutes 30 seconds ✓
```

Even with one retry (User A → User B), we stay well within the 3-minute window.

---

## Why Direct Charge (Not Authorization Hold)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    WHY DIRECT CHARGE                                        │
└─────────────────────────────────────────────────────────────────────────────┘

PROBLEM WITH AUTH HOLD:
───────────────────────
DMV automatically texts the user when booking is submitted.
If capture fails after submit, user gets:
  1. DMV: "Appointment confirmed!"
  2. Us: "Card failed, we canceled"
This is confusing and looks bad.


DIRECT CHARGE SOLVES THIS:
──────────────────────────
• Charge happens BEFORE submit
• If charge fails → we don't submit → no DMV confirmation sent
• User only gets one clear message from us
```

---

## Payment Flow During Booking

```
    Bot on final page (form filled)
           │
           ▼
    CHARGE booking fee (direct)
           │
      ┌────┴────┐
      ▼         ▼
   FAILS     SUCCEEDS
      │         │
      ▼         ▼
   Don't     CLICK SUBMIT
   submit         │
      │      ┌────┴────┐
      │      ▼         ▼
      │   FAILS     SUCCEEDS
      │      │         │
      │      ▼         ▼
      │   REFUND    DONE ✓
      │   (~$1.30    (DMV sends confirmation)
      │    lost)     (We send confirmation)
      │
      ▼
   User gets: "Card failed, update payment"
   No DMV message (we never submitted)
```

---

## Notification Timing

**Rule:** Don't notify mid-attempt. Wait until outcome is known.

### Scenario: User A fails, User B succeeds

After submit succeeds:

**To User A:**
```
⚠️ Payment Failed
Your card couldn't be charged for a Downtown appointment.
You're paused until you update your payment method.
Reply CARD to update.
```

**To User B:**
```
✅ Appointment Booked!
📍 Downtown
📅 March 15, 2026
🕐 9:30 AM
```

### Scenario: Both fail

After abandoning:
- Send "Payment Failed" message to both users
- Both move to `PAYMENT_ISSUE` state

---

## Cancel Window

If enabled (configurable), the bot holds on the confirmation page:

```
CANCEL WINDOW FLOW:
───────────────────

    Submit succeeds
           │
           ▼
    Bot stays on confirmation page
    (has "Cancel Appointment" button)
           │
           ▼
    Send notification with cancel option:
    "Reply CANCEL within 10 minutes if you need to undo"
           │
           │  Wait up to cancel_window_seconds
           │
    ┌──────┴──────┐
    ▼             ▼
USER CANCELS   TIMEOUT
    │             │
    ▼             ▼
Click Cancel   Navigate away
Refund fee     User → CONFIRMED
User → CANCELED
```

### Cancel Window Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `cancel_window_enabled` | true | Toggle feature on/off |
| `cancel_window_seconds` | 600 | Duration (10 minutes) |

---

## Edge Cases

### Only One Eligible User

- User B doesn't exist
- If User A's card fails → abandon, notify User A
- No backup, that's fine

### Both Cards Fail

- User A fails → try User B → User B fails
- Both users → `PAYMENT_ISSUE` state
- Abandon page
- Notify both: "Card failed, update payment"
- Slot goes back to pool
- Next bot run finds next 2 eligible users

### Submit Fails After Charge

- Refund the charge (~$1.30 fee lost)
- User stays in queue
- Text user: "Technical issue, refunded, still in queue"
- No confusing DMV message (we charged before submit)

### Slot Taken During Navigation

- Release locks
- Users return to `ACTIVE` state
- No charge attempted
- Will match on next slot

---

## Related Specs

- [Queue Mechanics](../queue-mechanics/spec.md) - User selection and locking
- [Payment & Pricing](../payment-pricing/spec.md) - Charge and refund handling
- [User States](../user-states/spec.md) - State transitions during booking
