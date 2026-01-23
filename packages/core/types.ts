// Shared types for queue and target window system
// See IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md

// Preset types (Section 4)
export type PresetType = 'date_horizon' | 'time_block' | 'weekday_rule';

export interface BasePreset {
  id: string;
  preset_type: PresetType;
  key: string;
  label: string;
  active: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

export interface DateHorizonPreset extends BasePreset {
  preset_type: 'date_horizon';
  rules_json: {
    days_ahead: number;
  };
}

export interface TimeBlockPreset extends BasePreset {
  preset_type: 'time_block';
  rules_json: {
    start: string; // HH:mm format
    end: string; // HH:mm format
  };
}

export interface WeekdayRulePreset extends BasePreset {
  preset_type: 'weekday_rule';
  rules_json: {
    mode: 'any' | 'custom';
  };
}

export type TargetWindowPreset = DateHorizonPreset | TimeBlockPreset | WeekdayRulePreset;

// Customer and queue types (Section 5)
export interface Customer {
  id: string;
  phone: string;
  email: string | null;
  created_at: Date;
}

export type QueueEntryStatus =
  | 'queued'
  | 'deposit_required'
  | 'active'
  | 'booked'
  | 'paused'
  | 'expired'
  | 'canceled';

export type DepositStatus = 'none' | 'required' | 'paid' | 'expired' | 'refunded';

export interface QueueEntry {
  id: string;
  customer_id: string;
  created_at: Date;
  status: QueueEntryStatus;
  deposit_status: DepositStatus;
  deposit_required_at: Date | null;
  deposit_paid_at: Date | null;
  deposit_expires_at: Date | null;
  booked_at: Date | null;
  booked_location_id: string | null;
  booked_slot_datetime: Date | null;
}

export interface UserTargetWindowSelection {
  customer_id: string;
  timezone: string;
  date_horizon_key: string;
  weekday_rule_key: string;
  custom_weekdays: number[]; // 1-5 for Mon-Fri
  time_block_keys: string[];
  updated_at: Date;
}

export interface UserLocationPreference {
  customer_id: string;
  location_id: string;
  created_at: Date;
}

export interface Location {
  id: string;
  name: string;
}

// Dispatcher types (Section 6)
export interface QueueWatermark {
  key: string;
  last_processed_at: Date;
}

export type BookingAttemptResult = 'success' | 'fail' | 'skipped';

export interface BookingAttempt {
  id: string;
  customer_id: string;
  location_id: string;
  slot_date: string; // YYYY-MM-DD
  slot_time: string; // HH:mm
  slot_datetime_utc: Date;
  attempt_at: Date;
  result: BookingAttemptResult;
  error_code: string | null;
  error_message: string | null;
  dispatcher_run_id: string;
}

export interface BookingLock {
  lock_key: string;
  locked_until: Date;
  owner_run_id: string;
}

export type MessageType =
  | 'deposit_needed'
  | 'deposit_received'
  | 'booked'
  | 'opportunity_passed'
  | 'status';

export interface MessageLogEntry {
  id: string;
  customer_id: string;
  message_type: MessageType;
  sent_at: Date;
  dedupe_key: string;
  meta_json: Record<string, unknown> | null;
}

// Slot state type (from existing monitoring tables)
export interface SlotState {
  location_id: string;
  slot_date: string;
  slot_time: string;
  first_seen: Date;
  last_seen: Date;
}

