# Code Review: Queue System V2 & Booking Bot

**Date:** February 1, 2026
**Reviewer:** Claude (Senior Engineer)
**Branch:** Monitoring-Bots-V2
**Status:** In Progress

---

## Summary

| Category | Score | Status |
|----------|-------|--------|
| Spec Compliance | 7/10 | Needs Work |
| Code Quality | 6/10 | Needs Work |
| Error Handling | 5/10 | Needs Work |
| Security | 6/10 | Needs Work |
| Testability | 5/10 | Needs Work |
| Maintainability | 7/10 | Acceptable |
| **Overall** | **6/10** | **Functional MVP, needs hardening** |

---

## Critical Issues (Must Fix Before Production)

### 1. Race Condition in User Selection
- [x] **RESOLVED**

**File:** `packages/queue/queue_service.ts`
**Function:** `selectUsersForBooking()`
**Severity:** 🔴 Critical

**Problem:**
```typescript
// Current code has gap between SELECT and UPDATE
const { data: users } = await supabase
  .from('queue_entries')
  .select('*')
  .eq('state', 'active')
  // ...

// Another bot could select same users here!

for (const user of users) {
  await supabase.from('queue_entries').update({ state: 'booking' })
}
```

**Impact:** Two bots could select the same user, leading to double booking attempts and confused state.

**Fix:** Create atomic database function with `FOR UPDATE SKIP LOCKED`:
```sql
CREATE FUNCTION select_users_for_booking_atomic(
  p_location_id UUID,
  p_slot_time TEXT,
  p_bot_id TEXT,
  p_limit INT
) RETURNS SETOF queue_entries AS $$
BEGIN
  RETURN QUERY
  UPDATE queue_entries
  SET
    state = 'booking',
    booking_bot_id = p_bot_id,
    booking_started_at = NOW()
  WHERE id IN (
    SELECT id FROM queue_entries
    WHERE location_id = p_location_id
      AND state = 'active'
    ORDER BY
      tier = 'priority' DESC,
      queue_entered_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$ LANGUAGE plpgsql;
```

**Assigned:** [ ]
**Resolved:** [ ]

---

### 2. No Phone Number Validation
- [x] **RESOLVED**

**File:** `packages/queue/notification_service.ts`
**Function:** `sendSms()`
**Severity:** 🔴 Critical

**Problem:**
```typescript
export async function sendSms(userId: string, phone: string, ...) {
  // No validation - could send to invalid numbers
  const message = await twilio.messages.create({
    to: phone, // Could be anything!
  });
}
```

**Impact:** Wasted Twilio credits, failed notifications, potential security issue.

**Fix:**
```typescript
const PHONE_REGEX = /^\+1\d{10}$/;

function isValidPhone(phone: string): boolean {
  return PHONE_REGEX.test(phone);
}

export async function sendSms(userId: string, phone: string, ...) {
  if (!isValidPhone(phone)) {
    console.error(`Invalid phone format: ${phone}`);
    return { success: false, error: 'Invalid phone format' };
  }
  // ...
}
```

**Assigned:** [ ]
**Resolved:** [ ]

---

### 3. No Retry on Stripe API Calls
- [x] **RESOLVED**

**File:** `packages/queue/payment_service.ts`
**Functions:** `chargeDeposit()`, `chargeBookingFee()`
**Severity:** 🟠 High

**Problem:**
```typescript
// Network blip = failed payment = user moved to PAYMENT_ISSUE
const paymentIntent = await stripe.paymentIntents.create(...);
```

**Impact:** Transient network errors cause unnecessary payment failures.

**Fix:**
```typescript
async function stripeWithRetry<T>(
  operation: () => Promise<T>,
  description: string
): Promise<T> {
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      // Only retry on network/timeout errors, not card declined
      if (error.type === 'StripeConnectionError' || error.code === 'ETIMEDOUT') {
        console.log(`Stripe ${description} failed (attempt ${attempt}), retrying...`);
        await new Promise(r => setTimeout(r, 1000 * attempt));
        continue;
      }
      throw error; // Don't retry card declined, etc.
    }
  }
  throw lastError;
}
```

**Assigned:** [ ]
**Resolved:** [ ]

---

## High Priority Issues

### 4. N+1 Query in Booking Bot
- [x] **RESOLVED**

**File:** `apps/booking-bot/booking-bot.ts`
**Function:** `bookSlot()`
**Severity:** 🟠 High

**Problem:**
```typescript
for (const su of selectedUsers) {
  const user = await getUser(su.user_id); // N queries!
}
```

**Fix:**
```typescript
const userIds = selectedUsers.map(u => u.user_id);
const { data: users } = await supabase
  .from('users')
  .select('*')
  .in('id', userIds); // 1 query

const userMap = new Map(users.map(u => [u.id, u]));
for (const su of selectedUsers) {
  const user = userMap.get(su.user_id);
}
```

**Assigned:** [ ]
**Resolved:** [ ]

---

### 5. Duplicate Location Mapping
- [x] **RESOLVED**

**Files:**
- `apps/booking-bot/booking-bot.ts`
- `apps/booking-bot/run-booking-bot.ts`

**Problem:**
```typescript
// booking-bot.ts
const LOCATIONS: Record<string, string> = {
  downtown: 'Downtown Satellite City Hall',
};

// run-booking-bot.ts (inverse, duplicated)
const locationCodes: Record<string, string> = {
  'Downtown Satellite City Hall': 'downtown',
};
```

**Fix:** Centralize in `packages/queue/location_service.ts`:
```typescript
export const LOCATION_CODES: Record<string, string> = {
  downtown: 'Downtown Satellite City Hall',
  hawaii_kai: 'Hawaii Kai Satellite City Hall',
  pearlridge: 'Pearlridge Satellite City Hall',
  windward: 'Windward City Satellite City Hall',
};

export const LOCATION_NAMES = Object.fromEntries(
  Object.entries(LOCATION_CODES).map(([k, v]) => [v, k])
);

export function getLocationCode(name: string): string | null {
  return LOCATION_NAMES[name] || null;
}

export function getLocationName(code: string): string | null {
  return LOCATION_CODES[code] || null;
}
```

**Assigned:** [ ]
**Resolved:** [ ]

---

### 6. Cancel Window Not Fully Implemented
- [x] **RESOLVED**

**File:** `apps/booking-bot/booking-bot.ts`
**Severity:** 🟠 High

**Problem:**
```typescript
// Current: Just waits, user can't actually cancel
await page.waitForTimeout(cancelSeconds * 1000);
```

**Spec says:** User should be able to reply "CANCEL" during window and bot should click cancel button.

**Fix Options:**
1. **Option A:** Disable cancel window feature until SMS webhook is implemented
2. **Option B:** Implement polling loop that checks for cancel requests:
```typescript
const pollInterval = 5000; // 5 seconds
const endTime = Date.now() + (cancelSeconds * 1000);

while (Date.now() < endTime) {
  // Check if user requested cancel
  const { data: entry } = await supabase
    .from('queue_entries')
    .select('cancel_requested')
    .eq('id', queueEntryId)
    .single();

  if (entry?.cancel_requested) {
    await clickCancelButton(page);
    await refundBookingFee(...);
    return { success: false, canceled: true };
  }

  await page.waitForTimeout(pollInterval);
}
```

**Assigned:** [ ]
**Resolved:** [ ]

---

## Medium Priority Issues

### 7. Magic Strings Throughout Codebase
- [ ] **OPEN**

**Severity:** 🟡 Medium

**Problem:** Strings like `'active'`, `'booking'`, `'deposit'` scattered everywhere.

**Fix:** Create `packages/core/constants.ts`:
```typescript
export const QUEUE_STATES = {
  WAITING: 'waiting',
  INVITED: 'invited',
  READY: 'ready',
  ACTIVE: 'active',
  BOOKING: 'booking',
  BOOKED: 'booked',
  PAYMENT_ISSUE: 'payment_issue',
  CONFIRMED: 'confirmed',
  COMPLETED: 'completed',
  CANCELED: 'canceled',
  EXPIRED: 'expired',
} as const;

export const TRANSACTION_TYPES = {
  DEPOSIT: 'deposit',
  BOOKING_FEE: 'booking_fee',
  REFUND_DEPOSIT: 'refund_deposit',
  REFUND_BOOKING: 'refund_booking',
} as const;
```

**Assigned:** [ ]
**Resolved:** [ ]

---

### 8. Hardcoded Configuration Values
- [ ] **OPEN**

**File:** `apps/booking-bot/booking-bot.ts`
**Severity:** 🟡 Medium

**Problem:**
```typescript
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
```

**Fix:** Use config_service:
```typescript
const maxRetries = await getConfigWithDefault('bot_max_retries', 3);
const retryDelayMs = await getConfigWithDefault('bot_retry_delay_ms', 1000);
```

**Assigned:** [ ]
**Resolved:** [ ]

---

### 9. No Dependency Injection (Hard to Test)
- [ ] **OPEN**

**Severity:** 🟡 Medium

**Problem:**
```typescript
export async function getUser(userId: string) {
  const supabase = getSupabaseClient(); // Hard to mock
}
```

**Fix:** Factory pattern:
```typescript
export function createUserService(supabase: SupabaseClient) {
  return {
    async getUser(userId: string) {
      const { data } = await supabase.from('users').select('*').eq('id', userId).single();
      return data;
    },
    // ...
  };
}

// Default export for convenience
export const userService = createUserService(getSupabaseClient());
```

**Assigned:** [ ]
**Resolved:** [ ]

---

### 10. Silent Failures in Notification Service
- [ ] **OPEN**

**File:** `packages/queue/notification_service.ts`
**Severity:** 🟡 Medium

**Problem:**
```typescript
catch (error: any) {
  console.error(`Failed to send SMS: ${error.message}`);
  return { success: false, error: error.message };
  // Caller might not check result!
}
```

**Fix:** Add critical notification tracking:
```typescript
// Log failed notifications to database for retry
await supabase.from('failed_notifications').insert({
  user_id: userId,
  message_type: messageType,
  error: error.message,
  retry_count: 0,
  created_at: new Date().toISOString(),
});
```

**Assigned:** [ ]
**Resolved:** [ ]

---

### 11. Browser Resource Leak Risk
- [ ] **OPEN**

**File:** `apps/booking-bot/booking-bot.ts`
**Severity:** 🟡 Medium

**Problem:** If `browser.close()` hangs, process leaks.

**Fix:**
```typescript
} finally {
  const closeWithTimeout = async (resource: any, name: string) => {
    if (!resource) return;
    try {
      await Promise.race([
        resource.close(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`${name} close timeout`)), 5000)
        )
      ]);
    } catch (e) {
      console.error(`Failed to close ${name}:`, e);
    }
  };

  await closeWithTimeout(page, 'page');
  await closeWithTimeout(context, 'context');
  await closeWithTimeout(browser, 'browser');
}
```

**Assigned:** [ ]
**Resolved:** [ ]

---

## Low Priority / Technical Debt

### 12. No Metrics/Monitoring
- [ ] **OPEN**

**Severity:** 🟢 Low

**Need:**
- Timing logs for each step
- Success/failure rates
- Stripe charge success rate
- DMV site response times

**Assigned:** [ ]
**Resolved:** [ ]

---

### 13. No Circuit Breaker for DMV Site
- [ ] **OPEN**

**Severity:** 🟢 Low

**Problem:** If DMV site is down, bot keeps hammering it.

**Fix:** Implement circuit breaker pattern - after N failures, stop trying for X minutes.

**Assigned:** [ ]
**Resolved:** [ ]

---

### 14. Missing Documentation
- [ ] **OPEN**

**Severity:** 🟢 Low

**Need:**
- [ ] README for booking-bot (how to run, env vars)
- [ ] State diagram (visual of all transitions)
- [ ] Runbook (what to do when bot fails)
- [ ] API docs for queue package exports

**Assigned:** [ ]
**Resolved:** [ ]

---

## Tests Needed

### Unit Tests
- [ ] `state_machine.test.ts` - State transitions, invalid transitions, history logging
- [ ] `queue_service.test.ts` - User selection, tier priority, time preferences
- [ ] `payment_service.test.ts` - Charge amounts, idempotency, error handling
- [ ] `notification_service.test.ts` - Message formatting, deduplication

### Integration Tests
- [ ] Full booking flow - primary user success
- [ ] Booking flow - fallback to backup user
- [ ] Booking flow - both users fail payment
- [ ] Navigation retry - DMV site slow/timeout

### Edge Case Tests
- [ ] User stuck in `booking` state for >5 minutes
- [ ] Concurrent bot selection of same user
- [ ] DMV site HTML structure changes
- [ ] Stripe webhook fires before code updates state

---

## Resolution Log

| Date | Issue # | Action Taken | Resolved By |
|------|---------|--------------|-------------|
| 2026-02-01 | #1 | Created atomic DB function `select_users_for_booking_atomic` with FOR UPDATE SKIP LOCKED. Updated queue_service.ts to use it. Added `release_users_from_booking_atomic` function. Migration: `packages/db/migrations/001_select_users_atomic.sql` | Claude |
| 2026-02-01 | #2 | Added `normalizePhoneNumber()` and `isValidPhoneNumber()` functions. `sendSms()` now validates and normalizes phone to E.164 format before sending. Supports multiple input formats: +18083426751, 8083426751, (808)342-6751, 808-342-6751 | Claude |
| 2026-02-01 | #3 | Added `stripeWithRetry()` function with exponential backoff. Only retries network/server errors (StripeConnectionError, StripeAPIError, StripeRateLimitError). Does NOT retry card declines or other non-retryable errors. Applied to `chargeDeposit()` and `chargeBookingFee()`. | Claude |
| 2026-02-01 | #4 | Added `getUsersByIds()` batch fetch function to user_service.ts. Updated booking-bot.ts to fetch all users in a single query instead of N individual queries. Reduces database calls from N+1 to 2 (one for user selection, one for user details). | Claude |
| 2026-02-01 | #5 | Centralized location code mappings in `location_service.ts` with `LOCATION_CODES`, `LOCATION_NAMES`, `getLocationCode()`, and `getLocationName()`. Removed duplicate mappings from booking-bot.ts and run-booking-bot.ts. | Claude |
| 2026-02-01 | #6 | Implemented cancel window polling with `pollForCancelRequest()` and `clickCancelButton()`. Polls database every 5s for `cancel_requested` flag. If set, clicks cancel button on DMV page and refunds booking fee. Requires SMS webhook to set flag when user texts CANCEL. | Claude |

---

## Notes

- All critical issues should be resolved before production deployment
- High priority issues should be resolved within 1 week
- Medium priority can be addressed in next sprint
- Low priority is technical debt to track

