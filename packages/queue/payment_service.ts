// Payment Service for Queue System V2
// See openspec/specs/payment-pricing/spec.md

import type { TransactionType, TransactionStatus, Tier } from '../core/types';
import { getSupabaseClient } from '../db/supabase_client';
import { transitionState } from './state_machine';
import { getLocationPricing } from './location_service';

// ============================================================================
// STRIPE CLIENT
// ============================================================================

// Stripe will be initialized with the API key from environment
// Using dynamic import to avoid issues if stripe isn't installed yet
let stripeClient: any = null;

async function getStripe() {
  if (!stripeClient) {
    const Stripe = (await import('stripe')).default;
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }
    stripeClient = new Stripe(apiKey, { apiVersion: '2023-10-16' });
  }
  return stripeClient;
}

// ============================================================================
// TYPES
// ============================================================================

export interface ChargeResult {
  success: boolean;
  charge_id?: string;
  error?: string;
  error_code?: string;
}

export interface RefundResult {
  success: boolean;
  refund_id?: string;
  error?: string;
}

export interface CustomerResult {
  success: boolean;
  customer_id?: string;
  error?: string;
}

// ============================================================================
// STRIPE RETRY LOGIC
// ============================================================================

const STRIPE_MAX_RETRIES = 3;
const STRIPE_RETRY_DELAY_MS = 1000;

// Stripe error types that are safe to retry
const RETRYABLE_ERROR_TYPES = [
  'StripeConnectionError',
  'StripeAPIError',      // 500 errors from Stripe
  'StripeRateLimitError',
];

// Specific error codes that should NOT be retried (card issues, etc.)
const NON_RETRYABLE_ERROR_CODES = [
  'card_declined',
  'expired_card',
  'incorrect_cvc',
  'processing_error',
  'incorrect_number',
  'invalid_expiry_month',
  'invalid_expiry_year',
  'insufficient_funds',
];

/**
 * Check if a Stripe error is retryable (network/server issues)
 */
function isRetryableStripeError(error: any): boolean {
  // Check error type
  if (error.type && RETRYABLE_ERROR_TYPES.includes(error.type)) {
    return true;
  }

  // Check for network-level errors
  if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error.code === 'ENOTFOUND') {
    return true;
  }

  // Check for Stripe decline codes - these should NOT be retried
  if (error.decline_code || NON_RETRYABLE_ERROR_CODES.includes(error.code)) {
    return false;
  }

  // Default: don't retry unknown errors
  return false;
}

/**
 * Execute a Stripe operation with retry logic for transient failures
 */
async function stripeWithRetry<T>(
  operation: () => Promise<T>,
  description: string
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= STRIPE_MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;

      // Check if this error is retryable
      if (!isRetryableStripeError(error)) {
        console.log(`[Payment] ${description} failed with non-retryable error: ${error.message}`);
        throw error; // Don't retry card declines, etc.
      }

      console.log(`[Payment] ${description} failed (attempt ${attempt}/${STRIPE_MAX_RETRIES}): ${error.message}`);

      if (attempt < STRIPE_MAX_RETRIES) {
        const delay = STRIPE_RETRY_DELAY_MS * attempt; // Exponential backoff
        console.log(`[Payment] Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error(`${description} failed after ${STRIPE_MAX_RETRIES} attempts`);
}

// ============================================================================
// STRIPE CUSTOMER MANAGEMENT
// ============================================================================

/**
 * Create a Stripe customer for a user
 */
export async function createStripeCustomer(
  userId: string,
  email?: string,
  phone?: string,
  name?: string
): Promise<CustomerResult> {
  try {
    const stripe = await getStripe();
    const supabase = getSupabaseClient();

    const customer = await stripe.customers.create({
      email: email || undefined,
      phone: phone || undefined,
      name: name || undefined,
      metadata: {
        user_id: userId,
      },
    });

    // Save customer ID to user record
    await supabase
      .from('users')
      .update({
        stripe_customer_id: customer.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    return { success: true, customer_id: customer.id };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to create Stripe customer',
    };
  }
}

/**
 * Get or create a Stripe customer for a user
 */
export async function getOrCreateStripeCustomer(
  userId: string,
  email?: string,
  phone?: string,
  name?: string
): Promise<string> {
  const supabase = getSupabaseClient();

  // Check if user already has a Stripe customer ID
  const { data: user } = await supabase
    .from('users')
    .select('stripe_customer_id, email, phone, name')
    .eq('id', userId)
    .single();

  if (user?.stripe_customer_id) {
    return user.stripe_customer_id;
  }

  // Create new customer
  const result = await createStripeCustomer(
    userId,
    email || user?.email,
    phone || user?.phone,
    name || user?.name
  );

  if (!result.success || !result.customer_id) {
    throw new Error(result.error || 'Failed to create Stripe customer');
  }

  return result.customer_id;
}

/**
 * Attach a payment method to a customer and set as default
 */
export async function attachPaymentMethod(
  customerId: string,
  paymentMethodId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const stripe = await getStripe();

    // Attach payment method to customer
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });

    // Set as default payment method
    await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });

    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to attach payment method',
    };
  }
}

// ============================================================================
// DEPOSIT COLLECTION
// ============================================================================

/**
 * Charge deposit when user moves from INVITED to READY
 *
 * @param userId - User ID
 * @param queueEntryId - Queue entry ID
 * @param locationId - Location ID (for pricing lookup)
 * @param tier - User's tier (for pricing lookup)
 */
export async function chargeDeposit(
  userId: string,
  queueEntryId: string,
  locationId: string,
  tier: Tier
): Promise<ChargeResult> {
  const supabase = getSupabaseClient();

  try {
    const stripe = await getStripe();

    // Get pricing
    const pricing = await getLocationPricing(locationId, tier);
    const amountCents = pricing.deposit_cents;

    // Get customer ID
    const customerId = await getOrCreateStripeCustomer(userId);

    // Create idempotency key
    const idempotencyKey = `deposit_${queueEntryId}_${Date.now()}`;

    // Create payment intent and confirm (with retry for transient failures)
    const paymentIntent = await stripeWithRetry(
      async () => stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: 'usd',
          customer: customerId,
          confirm: true,
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: 'never',
          },
          metadata: {
            user_id: userId,
            queue_entry_id: queueEntryId,
            type: 'deposit',
          },
        },
        { idempotencyKey }
      ),
      'charge deposit'
    ) as { id: string; status: string };

    if (paymentIntent.status !== 'succeeded') {
      return {
        success: false,
        error: 'Payment not completed',
        error_code: paymentIntent.status,
      };
    }

    // Record transaction
    await supabase.from('transactions').insert({
      user_id: userId,
      queue_entry_id: queueEntryId,
      type: 'deposit' as TransactionType,
      amount_cents: amountCents,
      location_id: locationId,
      tier: tier,
      stripe_payment_id: paymentIntent.id,
      status: 'completed' as TransactionStatus,
    });

    // Transition user to READY state
    await transitionState(queueEntryId, 'ready', {
      trigger_type: 'user_action',
      trigger_details: {
        stripe_payment_id: paymentIntent.id,
        amount_cents: amountCents,
      },
    });

    return { success: true, charge_id: paymentIntent.id };
  } catch (error: any) {
    // Record failed transaction
    await supabase.from('transactions').insert({
      user_id: userId,
      queue_entry_id: queueEntryId,
      type: 'deposit' as TransactionType,
      amount_cents: 0,
      location_id: locationId,
      tier: tier,
      status: 'failed' as TransactionStatus,
      metadata: { error: error.message, error_code: error.code },
    });

    return {
      success: false,
      error: error.message || 'Payment failed',
      error_code: error.code,
    };
  }
}

// ============================================================================
// BOOKING FEE COLLECTION
// ============================================================================

/**
 * Charge booking fee at moment of booking (direct charge, not auth hold)
 *
 * @param userId - User ID
 * @param queueEntryId - Queue entry ID
 * @param locationId - Location ID
 * @param tier - User's tier
 * @param slotId - Slot being booked (for idempotency)
 */
export async function chargeBookingFee(
  userId: string,
  queueEntryId: string,
  locationId: string,
  tier: Tier,
  slotId: string
): Promise<ChargeResult> {
  const supabase = getSupabaseClient();

  try {
    const stripe = await getStripe();

    // Get pricing
    const pricing = await getLocationPricing(locationId, tier);
    const amountCents = pricing.booking_fee_cents;

    // Get customer ID
    const { data: user } = await supabase
      .from('users')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (!user?.stripe_customer_id) {
      return {
        success: false,
        error: 'No payment method on file',
        error_code: 'no_payment_method',
      };
    }

    // Create idempotency key using slot ID to prevent duplicate charges
    const idempotencyKey = `booking_${userId}_${slotId}`;

    // Direct charge (not auth hold) with retry for transient failures
    const paymentIntent: { id: string; status: string } = await stripeWithRetry(
      async () => stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: 'usd',
          customer: user.stripe_customer_id,
          confirm: true,
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: 'never',
          },
          metadata: {
            user_id: userId,
            queue_entry_id: queueEntryId,
            slot_id: slotId,
            type: 'booking_fee',
          },
        },
        { idempotencyKey }
      ),
      'charge booking fee'
    );

    if (paymentIntent.status !== 'succeeded') {
      // Record failed attempt
      await supabase.from('booking_attempts').insert({
        user_id: userId,
        location_id: locationId,
        slot_id: slotId,
        result: 'payment_failed',
        payment_attempted: true,
        payment_result: paymentIntent.status,
        amount_cents: amountCents,
      });

      return {
        success: false,
        error: 'Payment not completed',
        error_code: paymentIntent.status,
      };
    }

    // Record successful transaction (booking record created by state transition)
    await supabase.from('transactions').insert({
      user_id: userId,
      queue_entry_id: queueEntryId,
      type: 'booking_fee' as TransactionType,
      amount_cents: amountCents,
      location_id: locationId,
      tier: tier,
      stripe_payment_id: paymentIntent.id,
      status: 'completed' as TransactionStatus,
    });

    return { success: true, charge_id: paymentIntent.id };
  } catch (error: any) {
    // Record failed transaction
    await supabase.from('transactions').insert({
      user_id: userId,
      queue_entry_id: queueEntryId,
      type: 'booking_fee' as TransactionType,
      amount_cents: 0,
      location_id: locationId,
      tier: tier,
      status: 'failed' as TransactionStatus,
      metadata: { error: error.message, error_code: error.code },
    });

    return {
      success: false,
      error: error.message || 'Payment failed',
      error_code: error.code,
    };
  }
}

// ============================================================================
// REFUNDS
// ============================================================================

/**
 * Refund a deposit
 */
export async function refundDeposit(
  userId: string,
  queueEntryId: string,
  reason: string
): Promise<RefundResult> {
  const supabase = getSupabaseClient();

  try {
    const stripe = await getStripe();

    // Find the original deposit transaction
    const { data: transaction } = await supabase
      .from('transactions')
      .select('*')
      .eq('queue_entry_id', queueEntryId)
      .eq('type', 'deposit')
      .eq('status', 'completed')
      .single();

    if (!transaction || !transaction.stripe_payment_id) {
      return { success: false, error: 'No deposit found to refund' };
    }

    // Create refund
    const idempotencyKey = `refund_deposit_${transaction.id}`;
    const refund = await stripe.refunds.create(
      {
        payment_intent: transaction.stripe_payment_id,
        reason: 'requested_by_customer',
        metadata: {
          user_id: userId,
          queue_entry_id: queueEntryId,
          original_transaction_id: transaction.id,
          reason: reason,
        },
      },
      { idempotencyKey }
    );

    // Record refund transaction
    await supabase.from('transactions').insert({
      user_id: userId,
      queue_entry_id: queueEntryId,
      type: 'refund_deposit' as TransactionType,
      amount_cents: transaction.amount_cents,
      location_id: transaction.location_id,
      tier: transaction.tier,
      stripe_refund_id: refund.id,
      status: 'completed' as TransactionStatus,
      metadata: { reason, original_transaction_id: transaction.id },
    });

    // Update original transaction status
    await supabase
      .from('transactions')
      .update({ status: 'refunded' as TransactionStatus })
      .eq('id', transaction.id);

    return { success: true, refund_id: refund.id };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Refund failed',
    };
  }
}

/**
 * Refund a booking fee by charge ID (used when submit fails after charge)
 */
export async function refundBookingFeeByChargeId(
  userId: string,
  chargeId: string,
  queueEntryId: string,
  reason: string
): Promise<RefundResult> {
  const supabase = getSupabaseClient();

  try {
    const stripe = await getStripe();

    // Find the transaction by stripe_payment_id
    const { data: transaction } = await supabase
      .from('transactions')
      .select('*')
      .eq('stripe_payment_id', chargeId)
      .eq('type', 'booking_fee')
      .eq('status', 'completed')
      .single();

    if (!transaction) {
      return { success: false, error: 'No transaction found for charge ID' };
    }

    // Create refund
    const idempotencyKey = `refund_charge_${chargeId}`;
    const refund = await stripe.refunds.create(
      {
        payment_intent: chargeId,
        reason: 'requested_by_customer',
        metadata: {
          user_id: userId,
          queue_entry_id: queueEntryId,
          original_transaction_id: transaction.id,
          reason: reason,
        },
      },
      { idempotencyKey }
    );

    // Record refund transaction
    await supabase.from('transactions').insert({
      user_id: userId,
      queue_entry_id: queueEntryId,
      type: 'refund_booking' as TransactionType,
      amount_cents: transaction.amount_cents,
      location_id: transaction.location_id,
      stripe_refund_id: refund.id,
      status: 'completed' as TransactionStatus,
      metadata: { reason, original_transaction_id: transaction.id },
    });

    // Update original transaction status
    await supabase
      .from('transactions')
      .update({ status: 'refunded' as TransactionStatus })
      .eq('id', transaction.id);

    return { success: true, refund_id: refund.id };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Refund failed',
    };
  }
}

/**
 * Refund a booking fee
 */
export async function refundBookingFee(
  userId: string,
  bookingId: string,
  reason: string
): Promise<RefundResult> {
  const supabase = getSupabaseClient();

  try {
    const stripe = await getStripe();

    // Find the booking and its transaction
    const { data: booking } = await supabase
      .from('bookings')
      .select('*, queue_entry_id')
      .eq('id', bookingId)
      .single();

    if (!booking || !booking.stripe_charge_id) {
      return { success: false, error: 'No booking fee found to refund' };
    }

    // Find the transaction
    const { data: transaction } = await supabase
      .from('transactions')
      .select('*')
      .eq('queue_entry_id', booking.queue_entry_id)
      .eq('type', 'booking_fee')
      .eq('status', 'completed')
      .single();

    if (!transaction) {
      return { success: false, error: 'No transaction found for booking' };
    }

    // Create refund
    const idempotencyKey = `refund_booking_${bookingId}`;
    const refund = await stripe.refunds.create(
      {
        payment_intent: transaction.stripe_payment_id,
        reason: 'requested_by_customer',
        metadata: {
          user_id: userId,
          booking_id: bookingId,
          original_transaction_id: transaction.id,
          reason: reason,
        },
      },
      { idempotencyKey }
    );

    // Record refund transaction
    await supabase.from('transactions').insert({
      user_id: userId,
      queue_entry_id: booking.queue_entry_id,
      booking_id: bookingId,
      type: 'refund_booking' as TransactionType,
      amount_cents: transaction.amount_cents,
      location_id: booking.location_id,
      stripe_refund_id: refund.id,
      status: 'completed' as TransactionStatus,
      metadata: { reason, original_transaction_id: transaction.id },
    });

    // Update original transaction status
    await supabase
      .from('transactions')
      .update({ status: 'refunded' as TransactionStatus })
      .eq('id', transaction.id);

    return { success: true, refund_id: refund.id };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Refund failed',
    };
  }
}

// ============================================================================
// PAYMENT METHOD VALIDATION
// ============================================================================

/**
 * Validate a user's payment method with a small auth (no charge)
 * Used when user updates their card after a payment issue
 */
export async function validatePaymentMethod(
  userId: string,
  queueEntryId: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const stripe = await getStripe();
    const supabase = getSupabaseClient();

    const { data: user } = await supabase
      .from('users')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (!user?.stripe_customer_id) {
      return { valid: false, error: 'No payment method on file' };
    }

    // Create a $0.50 auth (minimum amount) that we'll immediately cancel
    // This verifies the card is valid without actually charging
    const setupIntent = await stripe.setupIntents.create({
      customer: user.stripe_customer_id,
      confirm: true,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never',
      },
    });

    if (setupIntent.status === 'succeeded') {
      // Card is valid, transition user back to ACTIVE
      await transitionState(queueEntryId, 'active', {
        trigger_type: 'user_action',
        trigger_details: { reason: 'payment_method_updated' },
      });

      return { valid: true };
    }

    return { valid: false, error: 'Card validation failed' };
  } catch (error: any) {
    return {
      valid: false,
      error: error.message || 'Card validation failed',
    };
  }
}

// ============================================================================
// PAYMENT LINK GENERATION
// ============================================================================

/**
 * Create a Stripe Checkout session for deposit payment
 * Returns a URL the user can click to pay
 */
export async function createDepositPaymentLink(
  userId: string,
  queueEntryId: string,
  locationId: string,
  tier: Tier,
  successUrl: string,
  cancelUrl: string
): Promise<{ url: string | null; error?: string }> {
  try {
    const stripe = await getStripe();

    // Get pricing
    const pricing = await getLocationPricing(locationId, tier);

    // Get or create customer
    const customerId = await getOrCreateStripeCustomer(userId);

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'DMV Appointment Queue Deposit',
              description: `Refundable deposit for ${tier} tier`,
            },
            unit_amount: pricing.deposit_cents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        user_id: userId,
        queue_entry_id: queueEntryId,
        location_id: locationId,
        tier: tier,
        type: 'deposit',
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return { url: session.url };
  } catch (error: any) {
    return {
      url: null,
      error: error.message || 'Failed to create payment link',
    };
  }
}
