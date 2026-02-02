// Shared types for Queue System V2
// See openspec/specs/ for documentation

// ============================================================================
// USER & QUEUE TYPES
// ============================================================================

export interface User {
  id: string;
  phone: string;
  email: string | null;
  name: string | null;
  stripe_customer_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export type QueueState =
  | 'waiting'      // On waitlist, no deposit paid
  | 'invited'      // Invited to join queue, awaiting deposit
  | 'ready'        // Deposit paid, in pre-queue
  | 'active'       // In active queue, eligible for booking
  | 'booking'      // Currently being booked by bot
  | 'booked'       // Booking complete, in cancel window
  | 'payment_issue' // Card failed, paused until fixed
  | 'confirmed'    // Cancel window expired, appointment locked
  | 'completed'    // Appointment attended
  | 'canceled'     // User canceled
  | 'expired';     // Timed out

export type Tier = 'priority' | 'flexible';

export type TimePreference = 'morning' | 'midday' | 'afternoon' | null;

export interface QueueEntry {
  id: string;
  user_id: string;
  location_id: string;
  tier: Tier;
  time_preference: TimePreference;
  state: QueueState;
  booking_bot_id: string | null;
  booking_started_at: Date | null;
  booking_slot_id: string | null;
  invited_at: Date | null;
  deposit_paid_at: Date | null;
  queue_entered_at: Date | null;
  booked_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// LOCATION TYPES
// ============================================================================

export type PricingTier = 'standard' | 'high_traffic';

export interface Location {
  id: string;
  name: string;
  code: string;
  pricing_tier: PricingTier;
  queue_size_limit: number;
  is_active: boolean;
}

// ============================================================================
// BOOKING TYPES
// ============================================================================

export type BookingStatus = 'booked' | 'confirmed' | 'canceled' | 'completed';

export interface Booking {
  id: string;
  user_id: string;
  queue_entry_id: string;
  location_id: string;
  appointment_date: string; // YYYY-MM-DD
  appointment_time: string; // HH:MM:SS
  dmv_confirmation_number: string | null;
  status: BookingStatus;
  cancel_window_ends_at: Date | null;
  booking_fee_cents: number;
  stripe_charge_id: string | null;
  created_at: Date;
}

// ============================================================================
// TRANSACTION TYPES
// ============================================================================

export type TransactionType = 'deposit' | 'booking_fee' | 'refund_deposit' | 'refund_booking';
export type TransactionStatus = 'pending' | 'completed' | 'failed' | 'refunded';

export interface Transaction {
  id: string;
  user_id: string;
  queue_entry_id: string | null;
  booking_id: string | null;
  type: TransactionType;
  amount_cents: number;
  location_id: string | null;
  tier: Tier | null;
  stripe_payment_id: string | null;
  stripe_refund_id: string | null;
  status: TransactionStatus;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

// ============================================================================
// BOT & ANALYTICS TYPES
// ============================================================================

export type BotType = 'monitor' | 'booking' | 'cleanup';
export type BotRunStatus = 'success' | 'error' | 'timeout';

export interface BotRun {
  id: string;
  bot_type: BotType;
  started_at: Date;
  ended_at: Date | null;
  status: BotRunStatus | null;
  slots_found: number;
  slots_new: number;
  users_attempted: number;
  booking_result: string | null;
  booked_user_id: string | null;
  error_message: string | null;
  duration_ms: number | null;
  created_at: Date;
}

export type BookingAttemptResult = 'success' | 'payment_failed' | 'submit_failed' | 'slot_taken' | 'skipped';

export interface BookingAttempt {
  id: string;
  bot_run_id: string | null;
  user_id: string | null;
  slot_id: string | null;
  location_id: string | null;
  attempt_number: number | null;
  slot_date: string | null;
  slot_time: string | null;
  started_at: Date;
  ended_at: Date | null;
  duration_ms: number | null;
  result: BookingAttemptResult;
  error_code: string | null;
  error_message: string | null;
  payment_attempted: boolean;
  payment_result: string | null;
  stripe_charge_id: string | null;
  amount_cents: number | null;
  screenshot_url: string | null; // Failure screenshot stored in Supabase Storage
  created_at: Date;
}

// ============================================================================
// STATE HISTORY TYPES
// ============================================================================

export type TriggerType = 'user_action' | 'bot_action' | 'system' | 'admin' | 'cleanup';

export interface UserStateHistory {
  id: string;
  user_id: string;
  queue_entry_id: string | null;
  from_state: QueueState | null;
  to_state: QueueState;
  trigger_type: TriggerType | null;
  trigger_details: Record<string, unknown> | null;
  created_at: Date;
}

// ============================================================================
// MESSAGE TYPES
// ============================================================================

export type MessageType =
  | 'welcome'
  | 'waitlist_joined'
  | 'invite'
  | 'invite_reminder'
  | 'deposit_confirmed'
  | 'queue_entered'
  | 'booked'
  | 'confirmed'
  | 'payment_failed'
  | 'booking_submit_failed'
  | 'canceled'
  | 'expired'
  | 'status';

export interface MessageLogEntry {
  id: string;
  user_id: string;
  message_type: MessageType;
  dedupe_key: string;
  channel: 'sms' | 'email';
  sent_at: Date;
  metadata: Record<string, unknown> | null;
}

// ============================================================================
// SLOT TYPES (from monitoring bot)
// ============================================================================

export interface SlotState {
  location_id: string;
  slot_date: string;
  slot_time: string;
  first_seen: Date;
  last_seen: Date;
}

// ============================================================================
// SLOT LOCK TYPES
// ============================================================================

export interface SlotLock {
  lock_key: string;
  locked_by_bot_id: string;
  locked_at: Date;
  expires_at: Date;
}

// ============================================================================
// CONFIG TYPES
// ============================================================================

export interface AdminConfig {
  key: string;
  value: unknown;
  description: string | null;
  updated_at: Date;
  updated_by: string | null;
}

export interface PricingConfig {
  deposit_cents: number;
  booking_fee_cents: number;
}
