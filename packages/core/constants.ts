// Core Constants for Queue System V2
// Single source of truth for string literals used across the codebase

// ============================================================================
// QUEUE STATES
// ============================================================================

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

export type QueueStateValue = typeof QUEUE_STATES[keyof typeof QUEUE_STATES];

// ============================================================================
// TRANSACTION TYPES
// ============================================================================

export const TRANSACTION_TYPES = {
  DEPOSIT: 'deposit',
  BOOKING_FEE: 'booking_fee',
  REFUND_DEPOSIT: 'refund_deposit',
  REFUND_BOOKING: 'refund_booking',
} as const;

export type TransactionTypeValue = typeof TRANSACTION_TYPES[keyof typeof TRANSACTION_TYPES];

// ============================================================================
// TIERS
// ============================================================================

export const TIERS = {
  PRIORITY: 'priority',
  FLEXIBLE: 'flexible',
} as const;

export type TierValue = typeof TIERS[keyof typeof TIERS];

// ============================================================================
// TIME PREFERENCES
// ============================================================================

export const TIME_PREFERENCES = {
  ANY: 'any',
  MORNING: 'morning',
  MIDDAY: 'midday',
  AFTERNOON: 'afternoon',
} as const;

export type TimePreferenceValue = typeof TIME_PREFERENCES[keyof typeof TIME_PREFERENCES];

// ============================================================================
// MESSAGE TYPES
// ============================================================================

export const MESSAGE_TYPES = {
  WELCOME: 'welcome',
  TIER_SELECTION: 'tier_selection',
  WAITLIST_CONFIRMED: 'waitlist_confirmed',
  INVITE: 'invite',
  DEPOSIT_CONFIRMED: 'deposit_confirmed',
  QUEUE_ENTRY: 'queue_entry',
  BOOKED: 'booked',
  BOOKING_CONFIRMED: 'booking_confirmed',
  PAYMENT_FAILED: 'payment_failed',
  BOOKING_SUBMIT_FAILED: 'booking_submit_failed',
  CARD_UPDATED: 'card_updated',
  CANCEL_CONFIRMED: 'cancel_confirmed',
  INVITE_EXPIRED: 'invite_expired',
  STATUS: 'status',
  HELP: 'help',
} as const;

export type MessageTypeValue = typeof MESSAGE_TYPES[keyof typeof MESSAGE_TYPES];

// ============================================================================
// BOT TYPES
// ============================================================================

export const BOT_TYPES = {
  MONITORING: 'monitoring',
  BOOKING: 'booking',
} as const;

export type BotTypeValue = typeof BOT_TYPES[keyof typeof BOT_TYPES];

// ============================================================================
// PRICING TIERS
// ============================================================================

export const PRICING_TIERS = {
  STANDARD: 'standard',
  HIGH_TRAFFIC: 'high_traffic',
} as const;

export type PricingTierValue = typeof PRICING_TIERS[keyof typeof PRICING_TIERS];

// ============================================================================
// ERROR CODES
// ============================================================================

export const ERROR_CODES = {
  // Booking errors
  LOCK_FAILED: 'lock_failed',
  NO_USERS: 'no_users',
  USER_LOAD_FAILED: 'user_load_failed',
  NAVIGATION_FAILED: 'navigation_failed',
  ALL_PAYMENTS_FAILED: 'all_payments_failed',
  SUBMIT_FAILED: 'submit_failed',
  USER_CANCELED: 'user_canceled',
  EXCEPTION: 'exception',
  UNEXPECTED: 'unexpected',

  // Payment errors
  CARD_DECLINED: 'card_declined',
  INSUFFICIENT_FUNDS: 'insufficient_funds',
  EXPIRED_CARD: 'expired_card',
  PROCESSING_ERROR: 'processing_error',
} as const;

export type ErrorCodeValue = typeof ERROR_CODES[keyof typeof ERROR_CODES];
