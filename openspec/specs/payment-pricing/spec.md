# Payment & Pricing

> **Last Updated:** February 2026

---

## Payment Processor: Stripe

**Why Stripe:**
- Excellent API and documentation
- 2.9% + $0.30 per transaction (only pay when you make money)
- Built-in idempotency keys
- Handles disputes, refunds, compliance
- Test mode for development

---

## Two Payment Types

| Payment | When Collected | Purpose |
|---------|----------------|---------|
| **Deposit** | When entering pre-queue | Commitment to book, refundable |
| **Booking Fee** | At moment of booking | Service fee, final payment |

---

## Pricing Matrix

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    LOCATION × TIER PRICING MATRIX                           │
└─────────────────────────────────────────────────────────────────────────────┘

                          STANDARD LOCATIONS      HIGH-TRAFFIC LOCATIONS
                          (Hawaii Kai,            (Downtown,
                           Windward City)          Pearlridge)
    ══════════════════════════════════════════════════════════════════════════

    🌊 FLEXIBLE TIER
       (1-4 week window)
       ─────────────────
       Deposit                 $5                      $10
       Booking Fee             $25                     $35
       ───────────────────────────────────────────────────────────────────────
       TOTAL if booked         $30                     $45


    ⚡ PRIORITY TIER
       (2 week window)
       ─────────────────
       Deposit                 $10                     $15
       Booking Fee             $30                     $40
       ───────────────────────────────────────────────────────────────────────
       TOTAL if booked         $40                     $55
```

**All values are runtime-adjustable via `admin_config` table.**

---

## Location Pricing Tiers

| Location | Pricing Tier | Reason |
|----------|--------------|--------|
| Downtown | High-traffic | Most demand, fewer slots |
| Hawaii Kai | Standard | Lower demand |
| Pearlridge | High-traffic | High demand |
| Windward City | Standard | Lower demand |

---

## Payment Flow: Direct Charge

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    BOOKING FEE COLLECTION                                   │
└─────────────────────────────────────────────────────────────────────────────┘

    Bot on final page (form filled, ready to submit)
           │
           ▼
    CHARGE booking fee (direct, not auth hold)
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
      │   (~$1.30
      │    lost)
      │
      ▼
   User → PAYMENT_ISSUE
   Try backup user if available
```

### Why Direct Charge (Not Authorization Hold)

DMV automatically texts users when a booking is submitted. With auth hold:
- If capture fails after submit → user gets DMV confirmation, then our cancellation
- This is confusing

With direct charge:
- If charge fails → we don't submit → no DMV confirmation sent
- User gets one clear message from us

---

## Deposit Collection

Deposits are collected when user moves from `INVITED` to `READY` state:

1. User receives invite with payment link
2. User clicks link, enters card
3. Stripe charges deposit amount
4. On success: user state → `READY`
5. On failure: user stays `INVITED`, can retry

### Deposit Payment Window

- User has **24 hours** to pay after invite
- Configurable via `admin_config.deposit_payment_window_hours`
- If timeout: user returns to `WAITING` or moves to `EXPIRED`

---

## Refund Conditions

### Deposit Refund

| Condition | Refund? |
|-----------|---------|
| User cancels before being booked | Yes |
| User stuck in queue >2 weeks (upon request) | Yes |
| System error prevents booking | Yes |
| User successfully booked | No (applied to service) |

### Booking Fee Refund

| Condition | Refund? |
|-----------|---------|
| User requests cancel within cancel window | Yes |
| Technical failure (submit failed after charge) | Yes |
| User cancels after cancel window | No |
| Appointment completed | No |

---

## One-Strike Payment Policy

After **1 payment failure**, user must update their card:

```
ANY PAYMENT FAILURE (deposit or booking fee)
         │
         ▼
    User → PAYMENT_ISSUE state
    User paused until card updated
    Queue position preserved
         │
         │  User replies "CARD" and updates
         ▼
    Validate new card (small auth)
    If valid: state → ACTIVE
    Resume matching
```

### Why One Strike?

- Prevents repeated failed attempts that waste slots
- User's card clearly has an issue
- Quick fix: just update the card
- Position is preserved, no penalty except pause

---

## Stripe Integration Details

### Idempotency

All Stripe calls use idempotency keys:

```javascript
stripe.charges.create({
  amount: 3500,
  currency: 'usd',
  customer: user.stripe_customer_id,
}, {
  idempotencyKey: `booking_${user_id}_${slot_id}`
});
```

### Customer Setup

1. On first payment, create Stripe Customer
2. Save card as default payment method
3. Use saved card for booking fees (no re-entry needed)

### Refund Processing

```javascript
stripe.refunds.create({
  charge: original_charge_id,
  reason: 'requested_by_customer', // or 'duplicate', etc.
}, {
  idempotencyKey: `refund_${charge_id}`
});
```

---

## Configuration

### Pricing Config (admin_config table)

| Key | Value | Description |
|-----|-------|-------------|
| `pricing_standard_flexible` | `{"deposit_cents": 500, "booking_fee_cents": 2500}` | Standard + Flexible |
| `pricing_standard_priority` | `{"deposit_cents": 1000, "booking_fee_cents": 3000}` | Standard + Priority |
| `pricing_high_traffic_flexible` | `{"deposit_cents": 1000, "booking_fee_cents": 3500}` | High-traffic + Flexible |
| `pricing_high_traffic_priority` | `{"deposit_cents": 1500, "booking_fee_cents": 4000}` | High-traffic + Priority |

### Timing Config

| Key | Value | Description |
|-----|-------|-------------|
| `deposit_payment_window_hours` | `24` | Hours to pay deposit |
| `payment_issue_timeout_days` | `7` | Days to fix card before expiry |

---

## Related Specs

- [Booking Flow](../booking-flow/spec.md) - When payments are processed
- [User States](../user-states/spec.md) - Payment-related state transitions
- [Analytics](../analytics/spec.md) - Payment tracking and metrics
