# User States

> **Last Updated:** February 2026

---

## Three-Stage Funnel

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         WAITLIST (Free)                                     │
│                                                                             │
│   • Anyone can join via SMS                                                 │
│   • No payment required                                                     │
│   • User picks: Location, Tier (Priority/Flexible), Time preference         │
│   • System monitors supply, decides when to invite                          │
│                                                                             │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
                                      │ Invited when supply looks good
                                      │ (system believes booking possible within 2 weeks)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PRE-QUEUE (Deposit Collected)                       │
│                                                                             │
│   • User has 24 hours to pay deposit                                        │
│   • Committed, but not yet actively matching                                │
│   • "On deck" - ready to enter queue when spot opens                        │
│   • Pre-queue size = queue_size ÷ 2 per location                            │
│                                                                             │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
                                      │ Queue spot available
                                      │ (someone booked, canceled, or expired)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         QUEUE (Active Matching)                             │
│                                                                             │
│   • Actively matched against incoming slots                                 │
│   • Auto-booking enabled (deposit = pre-approval)                           │
│   • Size-controlled per location (adjustable at runtime)                    │
│   • Priority tier checked first, then Flexible tier                         │
│                                                                             │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
                                      │ Slot matched, payment processed, booking submitted
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BOOKED (Cancel Window)                              │
│                                                                             │
│   • Appointment secured on DMV site                                         │
│   • Booking fee charged                                                     │
│   • Cancel window: ~10 minutes (configurable, can disable)                  │
│   • After window: CONFIRMED (appointment locked)                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## User Options at Signup

```
LOCATION (pick one)
───────────────────
□ Downtown        (High-traffic)
□ Hawaii Kai      (Standard)
□ Pearlridge      (High-traffic)
□ Windward City   (Standard)


URGENCY TIER (pick one)
───────────────────────
⚡ PRIORITY
   • Book within 2 weeks of signup
   • Higher deposit/fee

🌊 FLEXIBLE
   • Book within 1-4 weeks of signup
   • Lower deposit/fee


TIME OF DAY (optional - discouraged)
────────────────────────────────────
Default: Any time (recommended - fastest booking)

Optional restriction (with warning):
□ Morning      (8:00am - 10:45am)
□ Midday       (11:00am - 1:45pm)
□ Afternoon    (2:00pm - 3:45pm)

⚠️ Warning shown: "Restricting time significantly reduces
   available appointments and may delay your booking."
```

---

## State Machine

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         USER STATE MACHINE                                  │
└─────────────────────────────────────────────────────────────────────────────┘

                         ┌──────────────┐
                         │  REGISTERED  │
                         └──────┬───────┘
                                │ picks location + tier + time pref
                                ▼
              ┌─────────────────────────────────────┐
              │             WAITLIST                │
              │                                     │
              │  State: WAITING                     │
              │  • Free, no commitment              │
              │  • Ordered by signup time           │
              └──────────────┬──────────────────────┘
                             │ invited (supply available)
                             ▼
              ┌─────────────────────────────────────┐
              │            PRE-QUEUE                │
              │                                     │
              │  State: INVITED                     │
              │  • Asked to pay deposit             │
              │  • Has 24 hours to pay              │
              │         │                           │
              │    ┌────┴────┐                      │
              │    ▼         ▼                      │
              │  pays    doesn't pay               │
              │    │         │                      │
              │    ▼         ▼                      │
              │  READY    WAITING                   │
              │           (or EXPIRED)              │
              └──────────────┬──────────────────────┘
                             │ queue spot available
                             ▼
              ┌─────────────────────────────────────┐
              │              QUEUE                  │
              │                                     │
              │  State: ACTIVE                      │
              │  • Actively matching                │
              │  • Auto-book enabled                │
              │                                     │
              │  State: BOOKING                     │
              │  • Bot is processing this user      │
              │  • Other bots skip this user        │
              │                                     │
              │  State: PAYMENT_ISSUE               │
              │  • Card failed                      │
              │  • Paused until card updated        │
              │  • Queue position preserved         │
              └──────────────┬──────────────────────┘
                             │ successfully booked
                             ▼
              ┌─────────────────────────────────────┐
              │           POST-BOOKING              │
              │                                     │
              │  State: BOOKED                      │
              │  • Cancel window open (~10 min)     │
              │                                     │
              │  State: CONFIRMED                   │
              │  • Appointment locked               │
              │  • Awaiting appointment date        │
              │                                     │
              │  State: COMPLETED                   │
              │  • Attended appointment             │
              └─────────────────────────────────────┘


              TERMINAL STATES
              ═══════════════
              CANCELED   - User voluntarily canceled
              EXPIRED    - Didn't pay deposit in time / timed out
              REFUNDED   - Deposit returned
```

---

## State Definitions

| State | Stage | Description |
|-------|-------|-------------|
| **WAITING** | Waitlist | Free, no commitment, ordered by signup time |
| **INVITED** | Pre-Queue | Asked to pay deposit, has 24 hours |
| **READY** | Pre-Queue | Deposit paid, waiting for queue spot |
| **ACTIVE** | Queue | Actively being matched against slots |
| **BOOKING** | Queue | Bot is currently processing this user |
| **PAYMENT_ISSUE** | Queue | Card failed, paused until updated |
| **BOOKED** | Post-Booking | Appointment secured, cancel window open |
| **CONFIRMED** | Post-Booking | Cancel window expired, appointment locked |
| **COMPLETED** | Terminal | Attended appointment |
| **CANCELED** | Terminal | User voluntarily canceled |
| **EXPIRED** | Terminal | Didn't pay deposit in time / timed out |
| **REFUNDED** | Terminal | Deposit returned |

---

## State Transitions

| From State | To State | Trigger |
|------------|----------|---------|
| - | WAITING | User signs up |
| WAITING | INVITED | System invites (supply available) |
| INVITED | READY | User pays deposit within 24h |
| INVITED | WAITING | Deposit payment times out (returns to waitlist) |
| INVITED | EXPIRED | Repeated timeout or user chooses to leave |
| READY | ACTIVE | Queue spot becomes available |
| ACTIVE | BOOKING | Bot selects user for booking attempt |
| BOOKING | BOOKED | Booking + payment successful |
| BOOKING | PAYMENT_ISSUE | Card declined |
| BOOKING | ACTIVE | Booking failed (slot taken), retrying |
| PAYMENT_ISSUE | ACTIVE | User updates payment method |
| PAYMENT_ISSUE | EXPIRED | User doesn't update card (7 day timeout) |
| BOOKED | CONFIRMED | Cancel window expires |
| BOOKED | CANCELED | User requests cancel within window |
| CONFIRMED | COMPLETED | Appointment date passes |
| Any | CANCELED | User requests cancellation |
| Any | REFUNDED | Deposit refunded (various conditions) |

---

## Related Specs

- [Queue Mechanics](../queue-mechanics/spec.md) - How users move through the queue
- [Payment & Pricing](../payment-pricing/spec.md) - Deposit and booking fee handling
