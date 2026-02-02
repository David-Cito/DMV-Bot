# System Overview

> **Last Updated:** February 2026
> **Status:** Planning Complete, Ready for Implementation

---

## Purpose

Automate DMV appointment booking for Hawaii locations. Users join a waitlist, pay a deposit when invited, and we automatically book appointments when slots become available.

### Goals

- Catch short-lived appointment openings (same-day to 4 weeks out)
- Eliminate manual checking for users
- Provide a managed, hands-off booking experience
- Maintain a fair, transparent queue system

### Business Model

- **Deposit:** Collected when user enters the queue (refundable under certain conditions)
- **Booking Fee:** Charged at moment of successful booking
- Pricing varies by location difficulty and urgency tier

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SYSTEM ARCHITECTURE                                 │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────────┐
                              │   DMV WEBSITE   │
                              └────────┬────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
              ▼                        │                        ▼
    ┌─────────────────┐                │              ┌─────────────────┐
    │  MONITORING BOT │                │              │   BOOKING BOT   │
    │   (Playwright)  │                │              │   (Playwright)  │
    │                 │                │              │                 │
    │ • Scans slots   │                │              │ • Fills forms   │
    │ • Every 2-3 min │                │              │ • Submits       │
    │ • All locations │                │              │ • Handles payment│
    └────────┬────────┘                │              └────────┬────────┘
             │                         │                       │
             │ writes                  │                       │ reads/writes
             ▼                         │                       ▼
    ┌────────────────────────────────────────────────────────────────────────┐
    │                            SUPABASE                                    │
    │                                                                        │
    │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │
    │  │ slot_states  │  │    users     │  │   pricing    │                 │
    │  │ (supply)     │  │  (profiles)  │  │  (config)    │                 │
    │  └──────────────┘  └──────────────┘  └──────────────┘                 │
    │                                                                        │
    │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │
    │  │   waitlist   │  │  pre_queue   │  │    queue     │                 │
    │  │  (waiting)   │  │ (deposit pd) │  │  (matching)  │                 │
    │  └──────────────┘  └──────────────┘  └──────────────┘                 │
    │                                                                        │
    │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │
    │  │   bookings   │  │ transactions │  │  analytics   │                 │
    │  │  (results)   │  │  (payments)  │  │   (metrics)  │                 │
    │  └──────────────┘  └──────────────┘  └──────────────┘                 │
    │                                                                        │
    └──────────────────────────────────┬─────────────────────────────────────┘
                                       │
                                       ▼
                          ┌─────────────────────────┐
                          │    CONVERSATION API     │
                          │    (Backend Server)     │
                          │                         │
                          │ • SMS webhook handler   │
                          │ • User state management │
                          │ • Payment processing    │
                          └────────────┬────────────┘
                                       │
                                       ▼
                          ┌─────────────────────────┐
                          │        TWILIO           │
                          │   (SMS Interface)       │
                          └────────────┬────────────┘
                                       │
                                       ▼
                          ┌─────────────────────────┐
                          │         USER            │
                          │    (Text Messages)      │
                          └─────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| **Monitoring Bot** | Scan DMV site every 2-3 min, detect new slots, write to database |
| **Booking Bot** | Read available slots, match to queue, fill forms, process payment, submit |
| **Supabase** | Store all data, provide realtime capabilities |
| **Conversation API** | Handle Twilio webhooks, manage user conversations, process payments |
| **Twilio** | Send/receive SMS, phone number provisioning |
| **Stripe** | Payment processing (deposits, booking fees, refunds) |

---

## Design Principles

### Idempotency

Every operation is safe to retry:
- Idempotency keys on all Stripe calls
- Conditional database updates (check state before changing)
- Message deduplication (dedupe_key on all notifications)
- Booking locks prevent duplicate attempts

### Simplicity

- Single location per user
- Two tiers (Priority/Flexible)
- Time preference is optional and discouraged
- State machine has clear transitions
- No complex priority algorithms (just tiered FIFO)

### Observability

- Every state change logged
- Every bot run logged
- Every payment logged
- Every error captured
- Daily metrics computed

### Recoverability

- Crashes handled via cleanup jobs
- Stuck states auto-reset
- User positions preserved through failures
- Refunds automated where possible

---

## Related Specs

- [Service Selection](../service-selection/spec.md) - Service type selection and demand tracking
- [User States](../user-states/spec.md) - State machine and transitions
- [Queue Mechanics](../queue-mechanics/spec.md) - Eligibility, priority, sizing
- [Booking Flow](../booking-flow/spec.md) - Dual-user booking process
- [Payment & Pricing](../payment-pricing/spec.md) - Stripe integration, pricing matrix
- [Notifications](../notifications/spec.md) - Twilio SMS interface
- [Database](../database/spec.md) - Schema and tables
- [Analytics](../analytics/spec.md) - Logging, metrics, configuration
