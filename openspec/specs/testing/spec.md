# Testing Strategy

> **Last Updated:** February 2026

---

## Overview

Testing strategy for the DMV Bot queue and booking system. Covers unit tests, integration tests, and end-to-end testing across all components.

---

## Testing Layers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TESTING PYRAMID                                   │
└─────────────────────────────────────────────────────────────────────────────┘

                            ┌───────────┐
                            │    E2E    │  ← Few, slow, high confidence
                            │   Tests   │
                           ─┴───────────┴─
                          ┌───────────────┐
                          │  Integration  │  ← Medium count, test boundaries
                          │    Tests      │
                        ─┬┴───────────────┴┬─
                        ┌┴─────────────────┴┐
                        │    Unit Tests     │  ← Many, fast, isolated
                        └───────────────────┘
```

---

## 1. Database Tests

### Schema Validation

Test that migration creates expected structure:

```javascript
describe('Database Schema', () => {
  test('queue_entries table has all required columns', async () => {
    const columns = await db.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'queue_entries'
    `);

    expect(columns).toContainEqual({
      column_name: 'state',
      data_type: 'text',
      is_nullable: 'NO'
    });
    // ... check all columns
  });

  test('all indexes exist', async () => {
    const indexes = await db.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'queue_entries'
    `);

    expect(indexes.map(i => i.indexname)).toContain('idx_queue_active');
    expect(indexes.map(i => i.indexname)).toContain('idx_queue_waiting');
  });

  test('foreign key constraints are enforced', async () => {
    await expect(
      db.query(`INSERT INTO queue_entries (user_id, location_id, tier, state)
                VALUES ('00000000-0000-0000-0000-000000000000',
                        '00000000-0000-0000-0000-000000000001',
                        'priority', 'waiting')`)
    ).rejects.toThrow(/foreign key/);
  });
});
```

### Function Tests

```javascript
describe('Database Functions', () => {
  describe('acquire_slot_lock', () => {
    test('acquires lock on unlocked slot', async () => {
      const result = await db.query(
        `SELECT acquire_slot_lock($1, $2, $3)`,
        ['downtown_2026-03-15_09:30', botId, 120]
      );
      expect(result.rows[0].acquire_slot_lock).toBe(true);
    });

    test('fails on already locked slot', async () => {
      await db.query(
        `SELECT acquire_slot_lock($1, $2, $3)`,
        ['downtown_2026-03-15_09:30', botId1, 120]
      );

      const result = await db.query(
        `SELECT acquire_slot_lock($1, $2, $3)`,
        ['downtown_2026-03-15_09:30', botId2, 120]
      );
      expect(result.rows[0].acquire_slot_lock).toBe(false);
    });

    test('allows reacquire by same bot', async () => {
      await db.query(
        `SELECT acquire_slot_lock($1, $2, $3)`,
        ['downtown_2026-03-15_09:30', botId, 120]
      );

      const result = await db.query(
        `SELECT acquire_slot_lock($1, $2, $3)`,
        ['downtown_2026-03-15_09:30', botId, 120]
      );
      expect(result.rows[0].acquire_slot_lock).toBe(true);
    });
  });

  describe('select_users_for_booking', () => {
    beforeEach(async () => {
      // Create test users in various states
      await createTestUser({ state: 'active', tier: 'priority', location: 'downtown' });
      await createTestUser({ state: 'active', tier: 'flexible', location: 'downtown' });
      await createTestUser({ state: 'active', tier: 'priority', location: 'hawaii_kai' });
      await createTestUser({ state: 'waiting', tier: 'priority', location: 'downtown' });
    });

    test('selects priority users before flexible', async () => {
      const result = await db.query(
        `SELECT * FROM select_users_for_booking($1, $2, $3, $4)`,
        [locationId, '09:30', botId, 2]
      );

      expect(result.rows[0].tier).toBe('priority');
    });

    test('respects location filter', async () => {
      const result = await db.query(
        `SELECT * FROM select_users_for_booking($1, $2, $3, $4)`,
        [downtownId, '09:30', botId, 2]
      );

      result.rows.forEach(row => {
        expect(row.location_id).toBe(downtownId);
      });
    });

    test('marks selected users as booking', async () => {
      const result = await db.query(
        `SELECT * FROM select_users_for_booking($1, $2, $3, $4)`,
        [locationId, '09:30', botId, 2]
      );

      for (const user of result.rows) {
        const entry = await db.query(
          `SELECT state, booking_bot_id FROM queue_entries WHERE user_id = $1`,
          [user.user_id]
        );
        expect(entry.rows[0].state).toBe('booking');
        expect(entry.rows[0].booking_bot_id).toBe(botId);
      }
    });

    test('respects time preference filter', async () => {
      await createTestUser({
        state: 'active',
        tier: 'priority',
        location: 'downtown',
        time_preference: 'afternoon'
      });

      const result = await db.query(
        `SELECT * FROM select_users_for_booking($1, $2, $3, $4)`,
        [locationId, '09:30', botId, 2]  // Morning slot
      );

      result.rows.forEach(row => {
        expect(row.time_preference).not.toBe('afternoon');
      });
    });

    test('returns max requested users', async () => {
      // Add more users
      for (let i = 0; i < 5; i++) {
        await createTestUser({ state: 'active', tier: 'priority', location: 'downtown' });
      }

      const result = await db.query(
        `SELECT * FROM select_users_for_booking($1, $2, $3, $4)`,
        [locationId, '09:30', botId, 2]
      );

      expect(result.rows.length).toBe(2);
    });
  });

  describe('log_state_change', () => {
    test('creates history record', async () => {
      const userId = await createTestUser({ state: 'waiting' });

      await db.query(
        `SELECT log_state_change($1, $2, $3, $4, $5, $6)`,
        [userId, entryId, 'waiting', 'invited', 'system', { reason: 'spot_available' }]
      );

      const history = await db.query(
        `SELECT * FROM user_state_history WHERE user_id = $1`,
        [userId]
      );

      expect(history.rows.length).toBe(1);
      expect(history.rows[0].from_state).toBe('waiting');
      expect(history.rows[0].to_state).toBe('invited');
    });
  });

  describe('cleanup_expired_locks', () => {
    test('removes expired locks', async () => {
      // Insert expired lock
      await db.query(`
        INSERT INTO slot_locks (lock_key, locked_by_bot_id, expires_at)
        VALUES ('test_lock', $1, NOW() - INTERVAL '1 minute')
      `, [botId]);

      await db.query(`SELECT cleanup_expired_locks()`);

      const locks = await db.query(`SELECT * FROM slot_locks WHERE lock_key = 'test_lock'`);
      expect(locks.rows.length).toBe(0);
    });

    test('preserves active locks', async () => {
      await db.query(`
        INSERT INTO slot_locks (lock_key, locked_by_bot_id, expires_at)
        VALUES ('active_lock', $1, NOW() + INTERVAL '1 minute')
      `, [botId]);

      await db.query(`SELECT cleanup_expired_locks()`);

      const locks = await db.query(`SELECT * FROM slot_locks WHERE lock_key = 'active_lock'`);
      expect(locks.rows.length).toBe(1);
    });
  });

  describe('reset_stuck_bookings', () => {
    test('resets bookings older than threshold', async () => {
      const userId = await createTestUser({
        state: 'booking',
        booking_started_at: new Date(Date.now() - 15 * 60 * 1000) // 15 min ago
      });

      await db.query(`SELECT reset_stuck_bookings(10)`);

      const entry = await db.query(
        `SELECT state FROM queue_entries WHERE user_id = $1`,
        [userId]
      );
      expect(entry.rows[0].state).toBe('active');
    });

    test('preserves recent bookings', async () => {
      const userId = await createTestUser({
        state: 'booking',
        booking_started_at: new Date(Date.now() - 5 * 60 * 1000) // 5 min ago
      });

      await db.query(`SELECT reset_stuck_bookings(10)`);

      const entry = await db.query(
        `SELECT state FROM queue_entries WHERE user_id = $1`,
        [userId]
      );
      expect(entry.rows[0].state).toBe('booking');
    });

    test('logs system event for each reset', async () => {
      const userId = await createTestUser({
        state: 'booking',
        booking_started_at: new Date(Date.now() - 15 * 60 * 1000)
      });

      await db.query(`SELECT reset_stuck_bookings(10)`);

      const events = await db.query(
        `SELECT * FROM system_events WHERE user_id = $1 AND event_type = 'booking_timeout_reset'`,
        [userId]
      );
      expect(events.rows.length).toBe(1);
    });
  });
});
```

---

## 2. State Machine Tests

### Valid Transitions

```javascript
describe('State Machine', () => {
  const validTransitions = {
    'waiting': ['invited', 'canceled', 'expired'],
    'invited': ['ready', 'waiting', 'expired'],
    'ready': ['active', 'canceled'],
    'active': ['booking', 'payment_issue', 'canceled'],
    'booking': ['booked', 'active', 'payment_issue'],
    'booked': ['confirmed', 'canceled'],
    'payment_issue': ['active', 'expired', 'canceled'],
    'confirmed': ['completed'],
    'completed': [],
    'canceled': [],
    'expired': []
  };

  Object.entries(validTransitions).forEach(([fromState, toStates]) => {
    describe(`from ${fromState}`, () => {
      toStates.forEach(toState => {
        test(`can transition to ${toState}`, async () => {
          const entry = await createQueueEntry({ state: fromState });

          await expect(
            transitionState(entry.id, toState)
          ).resolves.not.toThrow();

          const updated = await getQueueEntry(entry.id);
          expect(updated.state).toBe(toState);
        });
      });

      // Test invalid transitions
      const allStates = Object.keys(validTransitions);
      const invalidStates = allStates.filter(s => !toStates.includes(s) && s !== fromState);

      invalidStates.forEach(invalidState => {
        test(`cannot transition to ${invalidState}`, async () => {
          const entry = await createQueueEntry({ state: fromState });

          await expect(
            transitionState(entry.id, invalidState)
          ).rejects.toThrow(/invalid transition/i);
        });
      });
    });
  });
});
```

### State Side Effects

```javascript
describe('State Transition Side Effects', () => {
  test('invited → ready sets deposit_paid_at', async () => {
    const entry = await createQueueEntry({ state: 'invited' });

    await transitionState(entry.id, 'ready', {
      trigger: 'user_action',
      details: { stripe_payment_id: 'pi_123' }
    });

    const updated = await getQueueEntry(entry.id);
    expect(updated.deposit_paid_at).not.toBeNull();
  });

  test('ready → active sets queue_entered_at', async () => {
    const entry = await createQueueEntry({ state: 'ready' });

    await transitionState(entry.id, 'active');

    const updated = await getQueueEntry(entry.id);
    expect(updated.queue_entered_at).not.toBeNull();
  });

  test('active → booking sets booking fields', async () => {
    const entry = await createQueueEntry({ state: 'active' });

    await transitionState(entry.id, 'booking', {
      booking_bot_id: botId,
      booking_slot_id: slotId
    });

    const updated = await getQueueEntry(entry.id);
    expect(updated.booking_bot_id).toBe(botId);
    expect(updated.booking_slot_id).toBe(slotId);
    expect(updated.booking_started_at).not.toBeNull();
  });

  test('booking → booked creates booking record', async () => {
    const entry = await createQueueEntry({ state: 'booking' });

    await transitionState(entry.id, 'booked', {
      appointment_date: '2026-03-15',
      appointment_time: '09:30',
      dmv_confirmation: 'DMV123456'
    });

    const booking = await db.query(
      `SELECT * FROM bookings WHERE queue_entry_id = $1`,
      [entry.id]
    );
    expect(booking.rows.length).toBe(1);
    expect(booking.rows[0].dmv_confirmation_number).toBe('DMV123456');
  });

  test('all transitions log to user_state_history', async () => {
    const entry = await createQueueEntry({ state: 'waiting' });

    await transitionState(entry.id, 'invited');

    const history = await db.query(
      `SELECT * FROM user_state_history WHERE queue_entry_id = $1`,
      [entry.id]
    );
    expect(history.rows.length).toBe(1);
    expect(history.rows[0].from_state).toBe('waiting');
    expect(history.rows[0].to_state).toBe('invited');
  });
});
```

---

## 3. Payment Integration Tests

### Stripe Test Mode

Use Stripe test mode with test card numbers:

| Card Number | Behavior |
|-------------|----------|
| `4242424242424242` | Succeeds |
| `4000000000000002` | Declined |
| `4000000000009995` | Insufficient funds |
| `4000000000000341` | Attaches, but fails charge |

### Payment Tests

```javascript
describe('Payment Integration', () => {
  beforeAll(() => {
    // Ensure we're in test mode
    expect(process.env.STRIPE_SECRET_KEY).toMatch(/^sk_test_/);
  });

  describe('Deposit Collection', () => {
    test('successful deposit transitions to ready', async () => {
      const user = await createTestUser({
        stripe_customer_id: 'cus_test123',
        state: 'invited'
      });

      // Attach test card to customer
      await stripe.paymentMethods.attach('pm_card_visa', {
        customer: user.stripe_customer_id
      });

      const result = await collectDeposit(user.id, 500); // $5

      expect(result.success).toBe(true);

      const entry = await getQueueEntry(user.queue_entry_id);
      expect(entry.state).toBe('ready');
    });

    test('failed deposit keeps user in invited', async () => {
      const user = await createTestUser({
        stripe_customer_id: 'cus_test123',
        state: 'invited'
      });

      // Attach declining card
      await stripe.paymentMethods.attach('pm_card_chargeDeclined', {
        customer: user.stripe_customer_id
      });

      const result = await collectDeposit(user.id, 500);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/declined/i);

      const entry = await getQueueEntry(user.queue_entry_id);
      expect(entry.state).toBe('invited');
    });

    test('creates transaction record on success', async () => {
      const user = await createTestUser({ state: 'invited' });

      await collectDeposit(user.id, 500);

      const tx = await db.query(
        `SELECT * FROM transactions WHERE user_id = $1 AND type = 'deposit'`,
        [user.id]
      );
      expect(tx.rows.length).toBe(1);
      expect(tx.rows[0].amount_cents).toBe(500);
      expect(tx.rows[0].status).toBe('completed');
    });
  });

  describe('Booking Fee Charge', () => {
    test('successful charge allows booking completion', async () => {
      const user = await createTestUser({
        state: 'booking',
        stripe_customer_id: 'cus_test123'
      });

      const result = await chargeBookingFee(user.id, 2500); // $25

      expect(result.success).toBe(true);
      expect(result.charge_id).toMatch(/^ch_/);
    });

    test('failed charge triggers backup user', async () => {
      const primaryUser = await createTestUser({
        state: 'booking',
        stripe_customer_id: 'cus_declined'
      });
      const backupUser = await createTestUser({
        state: 'booking',
        stripe_customer_id: 'cus_valid'
      });

      const result = await attemptBookingWithBackup(
        primaryUser.id,
        backupUser.id,
        slotInfo
      );

      expect(result.booked_user_id).toBe(backupUser.id);

      const primaryEntry = await getQueueEntry(primaryUser.queue_entry_id);
      expect(primaryEntry.state).toBe('payment_issue');
    });

    test('records failed payment attempt', async () => {
      const user = await createTestUser({ state: 'booking' });

      await chargeBookingFee(user.id, 2500);

      const attempt = await db.query(
        `SELECT * FROM booking_attempts
         WHERE user_id = $1 AND payment_attempted = true`,
        [user.id]
      );
      expect(attempt.rows.length).toBe(1);
    });
  });

  describe('Refunds', () => {
    test('deposit refund on cancellation', async () => {
      const user = await createTestUser({ state: 'active' });
      const tx = await createTransaction({
        user_id: user.id,
        type: 'deposit',
        amount_cents: 500,
        stripe_payment_id: 'pi_test123'
      });

      await cancelUser(user.id, 'user_requested');

      const refund = await db.query(
        `SELECT * FROM transactions
         WHERE user_id = $1 AND type = 'refund_deposit'`,
        [user.id]
      );
      expect(refund.rows.length).toBe(1);
      expect(refund.rows[0].amount_cents).toBe(500);
    });

    test('booking fee refund during cancel window', async () => {
      const user = await createTestUser({ state: 'booked' });
      const booking = await createBooking({
        user_id: user.id,
        booking_fee_cents: 2500,
        stripe_charge_id: 'ch_test123',
        cancel_window_ends_at: new Date(Date.now() + 5 * 60 * 1000)
      });

      await cancelBooking(booking.id, 'user_requested');

      const refund = await db.query(
        `SELECT * FROM transactions
         WHERE user_id = $1 AND type = 'refund_booking'`,
        [user.id]
      );
      expect(refund.rows.length).toBe(1);
    });

    test('no refund after cancel window', async () => {
      const user = await createTestUser({ state: 'confirmed' });
      const booking = await createBooking({
        user_id: user.id,
        booking_fee_cents: 2500,
        cancel_window_ends_at: new Date(Date.now() - 5 * 60 * 1000)
      });

      await expect(
        cancelBooking(booking.id, 'user_requested')
      ).rejects.toThrow(/cancel window expired/i);
    });
  });

  describe('Idempotency', () => {
    test('duplicate deposit request returns same result', async () => {
      const user = await createTestUser({ state: 'invited' });
      const idempotencyKey = `deposit_${user.id}_${Date.now()}`;

      const result1 = await collectDeposit(user.id, 500, { idempotencyKey });
      const result2 = await collectDeposit(user.id, 500, { idempotencyKey });

      expect(result1.payment_id).toBe(result2.payment_id);

      const txCount = await db.query(
        `SELECT COUNT(*) FROM transactions WHERE user_id = $1`,
        [user.id]
      );
      expect(parseInt(txCount.rows[0].count)).toBe(1);
    });
  });
});
```

---

## 4. SMS/Twilio Tests

### Mock Twilio Client

```javascript
const mockTwilioClient = {
  messages: {
    create: jest.fn().mockResolvedValue({ sid: 'SM123' })
  }
};

describe('SMS Notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Message Templates', () => {
    test('invite message includes payment link', async () => {
      const user = await createTestUser({ phone: '+18081234567' });

      await sendInviteMessage(user.id, { location: 'Downtown', deposit: 500 });

      expect(mockTwilioClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          to: '+18081234567',
          body: expect.stringContaining('Pay your $5 deposit')
        })
      );
    });

    test('booked message includes appointment details', async () => {
      const user = await createTestUser({ phone: '+18081234567' });

      await sendBookedMessage(user.id, {
        location: 'Downtown',
        date: '2026-03-15',
        time: '09:30'
      });

      expect(mockTwilioClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringMatching(/Downtown.*March 15.*9:30/s)
        })
      );
    });

    test('payment failed message includes update instructions', async () => {
      await sendPaymentFailedMessage(userId);

      expect(mockTwilioClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('Reply CARD')
        })
      );
    });
  });

  describe('Message Deduplication', () => {
    test('does not send duplicate messages', async () => {
      const user = await createTestUser();
      const dedupeKey = `${user.id}_invite_1`;

      await sendInviteMessage(user.id, { dedupeKey });
      await sendInviteMessage(user.id, { dedupeKey });

      expect(mockTwilioClient.messages.create).toHaveBeenCalledTimes(1);
    });

    test('logs message to message_log', async () => {
      const user = await createTestUser();

      await sendInviteMessage(user.id, {});

      const log = await db.query(
        `SELECT * FROM message_log WHERE user_id = $1`,
        [user.id]
      );
      expect(log.rows.length).toBe(1);
      expect(log.rows[0].message_type).toBe('invite');
    });
  });

  describe('Incoming Message Handling', () => {
    test('STATUS command returns queue position', async () => {
      const user = await createTestUser({ state: 'active' });

      const response = await handleIncomingMessage(user.phone, 'STATUS');

      expect(response).toMatch(/queue position/i);
    });

    test('CANCEL command initiates cancellation', async () => {
      const user = await createTestUser({ state: 'active' });

      const response = await handleIncomingMessage(user.phone, 'CANCEL');

      expect(response).toMatch(/cancel/i);

      const entry = await getQueueEntry(user.queue_entry_id);
      expect(entry.state).toBe('canceled');
    });

    test('unknown command returns help', async () => {
      const response = await handleIncomingMessage('+18081234567', 'ASDFGH');

      expect(response).toMatch(/help|don't understand/i);
    });
  });

  describe('Conversation State', () => {
    test('new user starts location selection flow', async () => {
      const response = await handleIncomingMessage('+18081234567', 'Hi');

      expect(response).toMatch(/which location/i);

      const user = await getUserByPhone('+18081234567');
      expect(user.conversation_state).toBe('selecting_location');
    });

    test('location selection advances to tier selection', async () => {
      await createTestUser({
        phone: '+18081234567',
        conversation_state: 'selecting_location'
      });

      const response = await handleIncomingMessage('+18081234567', '1');

      expect(response).toMatch(/priority|flexible/i);

      const user = await getUserByPhone('+18081234567');
      expect(user.conversation_state).toBe('selecting_tier');
    });
  });
});
```

---

## 5. Booking Bot Tests

### Slot Detection

```javascript
describe('Booking Bot', () => {
  describe('Slot Matching', () => {
    test('matches slot to eligible users', async () => {
      const user = await createTestUser({
        state: 'active',
        tier: 'priority',
        location: 'downtown',
        time_preference: null
      });

      const slot = {
        location: 'downtown',
        date: '2026-03-15',
        time: '09:30'
      };

      const matches = await findEligibleUsers(slot, 2);

      expect(matches.map(m => m.user_id)).toContain(user.id);
    });

    test('respects time preference', async () => {
      const morningUser = await createTestUser({
        state: 'active',
        time_preference: 'morning'
      });
      const afternoonUser = await createTestUser({
        state: 'active',
        time_preference: 'afternoon'
      });

      const morningSlot = { time: '09:30' };
      const matches = await findEligibleUsers(morningSlot, 2);

      expect(matches.map(m => m.user_id)).toContain(morningUser.id);
      expect(matches.map(m => m.user_id)).not.toContain(afternoonUser.id);
    });

    test('priority tier matched before flexible', async () => {
      const flexUser = await createTestUser({
        state: 'active',
        tier: 'flexible',
        created_at: new Date('2026-01-01') // Older
      });
      const priorityUser = await createTestUser({
        state: 'active',
        tier: 'priority',
        created_at: new Date('2026-02-01') // Newer
      });

      const matches = await findEligibleUsers(slot, 1);

      expect(matches[0].user_id).toBe(priorityUser.id);
    });
  });

  describe('Dual User Booking', () => {
    test('attempts primary user first', async () => {
      const primary = await createTestUser({ state: 'active' });
      const backup = await createTestUser({ state: 'active' });

      const result = await bookSlotWithBackup([primary, backup], slotInfo);

      expect(result.attempted_users[0]).toBe(primary.id);
    });

    test('falls back to backup on primary payment failure', async () => {
      const primary = await createTestUser({
        state: 'active',
        payment_will_fail: true
      });
      const backup = await createTestUser({ state: 'active' });

      const result = await bookSlotWithBackup([primary, backup], slotInfo);

      expect(result.booked_user_id).toBe(backup.id);

      const primaryEntry = await getQueueEntry(primary.queue_entry_id);
      expect(primaryEntry.state).toBe('payment_issue');
    });

    test('releases both users if no slot available', async () => {
      const primary = await createTestUser({ state: 'booking' });
      const backup = await createTestUser({ state: 'booking' });

      await handleSlotUnavailable([primary.id, backup.id]);

      const primaryEntry = await getQueueEntry(primary.queue_entry_id);
      const backupEntry = await getQueueEntry(backup.queue_entry_id);

      expect(primaryEntry.state).toBe('active');
      expect(backupEntry.state).toBe('active');
    });
  });

  describe('Slot Locking', () => {
    test('acquires lock before booking attempt', async () => {
      const slotKey = 'downtown_2026-03-15_09:30';

      await startBookingAttempt(slotInfo, botId);

      const lock = await db.query(
        `SELECT * FROM slot_locks WHERE lock_key = $1`,
        [slotKey]
      );
      expect(lock.rows.length).toBe(1);
      expect(lock.rows[0].locked_by_bot_id).toBe(botId);
    });

    test('skips slot if already locked', async () => {
      const slotKey = 'downtown_2026-03-15_09:30';

      // Another bot has the lock
      await db.query(`
        INSERT INTO slot_locks (lock_key, locked_by_bot_id, expires_at)
        VALUES ($1, $2, NOW() + INTERVAL '2 minutes')
      `, [slotKey, 'other-bot-id']);

      const result = await startBookingAttempt(slotInfo, botId);

      expect(result.skipped).toBe(true);
      expect(result.reason).toMatch(/locked/i);
    });

    test('releases lock after booking', async () => {
      await startBookingAttempt(slotInfo, botId);
      await completeBookingAttempt(slotInfo, botId, 'success');

      const lock = await db.query(
        `SELECT * FROM slot_locks WHERE lock_key = $1`,
        [slotKey]
      );
      expect(lock.rows.length).toBe(0);
    });
  });
});
```

---

## 6. Queue Management Tests

```javascript
describe('Queue Management', () => {
  describe('Waitlist to Queue Promotion', () => {
    test('invites users when queue has space', async () => {
      // Location with queue_size_limit = 5
      const location = await createLocation({ queue_size_limit: 5 });

      // 3 active users in queue
      for (let i = 0; i < 3; i++) {
        await createTestUser({ state: 'active', location_id: location.id });
      }

      // 5 waiting users
      for (let i = 0; i < 5; i++) {
        await createTestUser({ state: 'waiting', location_id: location.id });
      }

      await processQueuePromotions(location.id);

      // Should invite up to pre_queue limit (queue_size / 2 = 2)
      const invited = await db.query(
        `SELECT COUNT(*) FROM queue_entries
         WHERE location_id = $1 AND state = 'invited'`,
        [location.id]
      );
      expect(parseInt(invited.rows[0].count)).toBe(2);
    });

    test('respects priority tier order', async () => {
      const location = await createLocation({ queue_size_limit: 4 });

      const flexUser = await createTestUser({
        state: 'waiting',
        tier: 'flexible',
        location_id: location.id,
        created_at: new Date('2026-01-01')
      });
      const priorityUser = await createTestUser({
        state: 'waiting',
        tier: 'priority',
        location_id: location.id,
        created_at: new Date('2026-02-01')
      });

      await processQueuePromotions(location.id);

      const priorityEntry = await getQueueEntry(priorityUser.queue_entry_id);
      expect(priorityEntry.state).toBe('invited');
    });
  });

  describe('Pre-Queue to Queue Promotion', () => {
    test('promotes ready users when queue has space', async () => {
      const location = await createLocation({ queue_size_limit: 5 });

      // 3 active users
      for (let i = 0; i < 3; i++) {
        await createTestUser({ state: 'active', location_id: location.id });
      }

      // 2 ready users in pre-queue
      const readyUsers = [];
      for (let i = 0; i < 2; i++) {
        readyUsers.push(await createTestUser({
          state: 'ready',
          location_id: location.id
        }));
      }

      await processQueuePromotions(location.id);

      for (const user of readyUsers) {
        const entry = await getQueueEntry(user.queue_entry_id);
        expect(entry.state).toBe('active');
      }
    });
  });

  describe('Invite Expiration', () => {
    test('expires invites after 24 hours', async () => {
      const user = await createTestUser({
        state: 'invited',
        invited_at: new Date(Date.now() - 25 * 60 * 60 * 1000) // 25 hours ago
      });

      await processExpiredInvites();

      const entry = await getQueueEntry(user.queue_entry_id);
      expect(entry.state).toBe('waiting');
      expect(entry.invited_at).toBeNull();
    });

    test('preserves recent invites', async () => {
      const user = await createTestUser({
        state: 'invited',
        invited_at: new Date(Date.now() - 12 * 60 * 60 * 1000) // 12 hours ago
      });

      await processExpiredInvites();

      const entry = await getQueueEntry(user.queue_entry_id);
      expect(entry.state).toBe('invited');
    });
  });
});
```

---

## 7. End-to-End Tests

### Full User Journey

```javascript
describe('E2E: Complete User Journey', () => {
  test('user signs up, gets booked, appointment confirmed', async () => {
    // 1. User texts in
    let response = await handleIncomingMessage('+18081234567', 'Hi');
    expect(response).toMatch(/which location/i);

    // 2. Select location
    response = await handleIncomingMessage('+18081234567', '1');
    expect(response).toMatch(/priority|flexible/i);

    // 3. Select tier
    response = await handleIncomingMessage('+18081234567', 'priority');
    expect(response).toMatch(/waitlist/i);

    // Verify user state
    const user = await getUserByPhone('+18081234567');
    expect(user.queue_entry.state).toBe('waiting');

    // 4. Simulate queue spot opening
    await processQueuePromotions(user.queue_entry.location_id);
    expect(await getLatestSmsTo('+18081234567')).toMatch(/deposit/i);

    const entryAfterInvite = await getQueueEntry(user.queue_entry.id);
    expect(entryAfterInvite.state).toBe('invited');

    // 5. User pays deposit (simulate Stripe webhook)
    await handleStripeWebhook({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          customer: user.stripe_customer_id,
          metadata: { queue_entry_id: user.queue_entry.id, type: 'deposit' }
        }
      }
    });

    const entryAfterDeposit = await getQueueEntry(user.queue_entry.id);
    expect(entryAfterDeposit.state).toBe('ready');

    // 6. Promote to active queue
    await processQueuePromotions(user.queue_entry.location_id);

    const entryAfterPromotion = await getQueueEntry(user.queue_entry.id);
    expect(entryAfterPromotion.state).toBe('active');

    // 7. Slot becomes available, booking bot runs
    const slot = await createSlot({
      location_id: user.queue_entry.location_id,
      date: '2026-03-15',
      time: '09:30'
    });

    await runBookingBot();

    const entryAfterBooking = await getQueueEntry(user.queue_entry.id);
    expect(entryAfterBooking.state).toBe('booked');

    // Verify booking created
    const booking = await db.query(
      `SELECT * FROM bookings WHERE queue_entry_id = $1`,
      [user.queue_entry.id]
    );
    expect(booking.rows.length).toBe(1);
    expect(booking.rows[0].appointment_date).toBe('2026-03-15');

    // Verify SMS sent
    expect(await getLatestSmsTo('+18081234567')).toMatch(/booked.*march 15/i);

    // 8. Cancel window expires
    await advanceTime(11 * 60 * 1000); // 11 minutes
    await processCancelWindows();

    const entryAfterConfirm = await getQueueEntry(user.queue_entry.id);
    expect(entryAfterConfirm.state).toBe('confirmed');
  });

  test('user cancellation during booking flow', async () => {
    const user = await setupUserInState('booked', {
      cancel_window_ends_at: new Date(Date.now() + 5 * 60 * 1000)
    });

    const response = await handleIncomingMessage(user.phone, 'CANCEL');

    expect(response).toMatch(/canceled.*refund/i);

    const entry = await getQueueEntry(user.queue_entry_id);
    expect(entry.state).toBe('canceled');

    const refund = await db.query(
      `SELECT * FROM transactions WHERE user_id = $1 AND type = 'refund_booking'`,
      [user.id]
    );
    expect(refund.rows.length).toBe(1);
  });

  test('payment failure triggers backup user', async () => {
    const primary = await setupUserInState('active', {
      payment_will_fail: true
    });
    const backup = await setupUserInState('active');

    const slot = await createSlot({
      location_id: primary.queue_entry.location_id,
      date: '2026-03-15',
      time: '09:30'
    });

    await runBookingBot();

    // Primary should be in payment_issue
    const primaryEntry = await getQueueEntry(primary.queue_entry_id);
    expect(primaryEntry.state).toBe('payment_issue');

    // Backup should be booked
    const backupEntry = await getQueueEntry(backup.queue_entry_id);
    expect(backupEntry.state).toBe('booked');

    // Primary got notification
    expect(await getLatestSmsTo(primary.phone)).toMatch(/payment failed/i);
  });
});
```

---

## 8. Test Environment Setup

### Database

```javascript
// test/setup.js
const { Client } = require('pg');

beforeAll(async () => {
  // Create test database
  const client = new Client({
    connectionString: process.env.TEST_DATABASE_URL
  });
  await client.connect();

  // Run migrations
  const migration = fs.readFileSync(
    'supabase/migrations/20260201_queue_system_v2.sql',
    'utf-8'
  );
  await client.query(migration);

  global.db = client;
});

afterAll(async () => {
  await global.db.end();
});

beforeEach(async () => {
  // Clean all tables
  await global.db.query(`
    TRUNCATE users, queue_entries, bookings, transactions,
             slot_locks, bot_runs, booking_attempts,
             user_state_history, system_events, message_log
    CASCADE
  `);
});
```

### Test Helpers

```javascript
// test/helpers.js

async function createTestUser(overrides = {}) {
  const defaults = {
    phone: `+1808${Math.random().toString().slice(2, 9)}`,
    email: `test${Date.now()}@example.com`,
    name: 'Test User'
  };

  const user = await db.query(`
    INSERT INTO users (phone, email, name, stripe_customer_id)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [
    overrides.phone || defaults.phone,
    overrides.email || defaults.email,
    overrides.name || defaults.name,
    overrides.stripe_customer_id || `cus_test${Date.now()}`
  ]);

  if (overrides.state) {
    const location = overrides.location_id || await getDefaultLocationId();

    const entry = await db.query(`
      INSERT INTO queue_entries (user_id, location_id, tier, state,
                                  time_preference, invited_at, booking_started_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      user.rows[0].id,
      location,
      overrides.tier || 'flexible',
      overrides.state,
      overrides.time_preference || null,
      overrides.invited_at || null,
      overrides.booking_started_at || null
    ]);

    user.rows[0].queue_entry_id = entry.rows[0].id;
    user.rows[0].queue_entry = entry.rows[0];
  }

  return user.rows[0];
}

async function createLocation(overrides = {}) {
  const result = await db.query(`
    INSERT INTO locations (name, code, pricing_tier, queue_size_limit, is_active)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [
    overrides.name || 'Test Location',
    overrides.code || `test_${Date.now()}`,
    overrides.pricing_tier || 'standard',
    overrides.queue_size_limit || 5,
    overrides.is_active !== false
  ]);

  return result.rows[0];
}

async function getQueueEntry(id) {
  const result = await db.query(
    `SELECT * FROM queue_entries WHERE id = $1`,
    [id]
  );
  return result.rows[0];
}

async function advanceTime(ms) {
  // For testing time-dependent features
  jest.advanceTimersByTime(ms);
}

module.exports = {
  createTestUser,
  createLocation,
  getQueueEntry,
  advanceTime
};
```

---

## 9. CI/CD Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/test.yml
name: Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: dmv_bot_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run database migrations
        env:
          DATABASE_URL: postgres://test:test@localhost:5432/dmv_bot_test
        run: npm run migrate

      - name: Run unit tests
        env:
          DATABASE_URL: postgres://test:test@localhost:5432/dmv_bot_test
          STRIPE_SECRET_KEY: sk_test_fake
        run: npm run test:unit

      - name: Run integration tests
        env:
          DATABASE_URL: postgres://test:test@localhost:5432/dmv_bot_test
          STRIPE_SECRET_KEY: ${{ secrets.STRIPE_TEST_KEY }}
        run: npm run test:integration

      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

---

## 10. Test Coverage Goals

| Component | Target Coverage |
|-----------|-----------------|
| State machine transitions | 100% |
| Database functions | 100% |
| Payment flows | 95% |
| SMS handling | 90% |
| Queue management | 95% |
| Booking bot logic | 90% |
| Edge cases | 85% |

---

## Running Tests

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests (requires test database)
npm run test:integration

# E2E tests
npm run test:e2e

# With coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

---

## Related Specs

- [Database](../database/spec.md) - Schema being tested
- [User States](../user-states/spec.md) - State transitions
- [Booking Flow](../booking-flow/spec.md) - Booking scenarios
- [Payment & Pricing](../payment-pricing/spec.md) - Payment test cases
