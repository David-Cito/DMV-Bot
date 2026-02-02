"use strict";
// Core Constants for Queue System V2
// Single source of truth for string literals used across the codebase
Object.defineProperty(exports, "__esModule", { value: true });
exports.ERROR_CODES = exports.PRICING_TIERS = exports.BOT_TYPES = exports.MESSAGE_TYPES = exports.TIME_PREFERENCES = exports.TIERS = exports.TRANSACTION_TYPES = exports.QUEUE_STATES = void 0;
// ============================================================================
// QUEUE STATES
// ============================================================================
exports.QUEUE_STATES = {
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
};
// ============================================================================
// TRANSACTION TYPES
// ============================================================================
exports.TRANSACTION_TYPES = {
    DEPOSIT: 'deposit',
    BOOKING_FEE: 'booking_fee',
    REFUND_DEPOSIT: 'refund_deposit',
    REFUND_BOOKING: 'refund_booking',
};
// ============================================================================
// TIERS
// ============================================================================
exports.TIERS = {
    PRIORITY: 'priority',
    FLEXIBLE: 'flexible',
};
// ============================================================================
// TIME PREFERENCES
// ============================================================================
exports.TIME_PREFERENCES = {
    ANY: 'any',
    MORNING: 'morning',
    MIDDAY: 'midday',
    AFTERNOON: 'afternoon',
};
// ============================================================================
// MESSAGE TYPES
// ============================================================================
exports.MESSAGE_TYPES = {
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
};
// ============================================================================
// BOT TYPES
// ============================================================================
exports.BOT_TYPES = {
    MONITORING: 'monitoring',
    BOOKING: 'booking',
};
// ============================================================================
// PRICING TIERS
// ============================================================================
exports.PRICING_TIERS = {
    STANDARD: 'standard',
    HIGH_TRAFFIC: 'high_traffic',
};
// ============================================================================
// ERROR CODES
// ============================================================================
exports.ERROR_CODES = {
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
};
//# sourceMappingURL=constants.js.map