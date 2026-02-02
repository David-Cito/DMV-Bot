// Config Service for Queue System V2
// See openspec/specs/analytics/spec.md - Runtime Configuration

import { getSupabaseClient } from '../db/supabase_client';

// ============================================================================
// CONFIG KEYS
// ============================================================================

export const CONFIG_KEYS = {
  // Pricing
  PRICING_STANDARD_FLEXIBLE: 'pricing_standard_flexible',
  PRICING_STANDARD_PRIORITY: 'pricing_standard_priority',
  PRICING_HIGH_TRAFFIC_FLEXIBLE: 'pricing_high_traffic_flexible',
  PRICING_HIGH_TRAFFIC_PRIORITY: 'pricing_high_traffic_priority',

  // Timing
  DEPOSIT_PAYMENT_WINDOW_HOURS: 'deposit_payment_window_hours',
  CANCEL_WINDOW_ENABLED: 'cancel_window_enabled',
  CANCEL_WINDOW_SECONDS: 'cancel_window_seconds',
  PAYMENT_ISSUE_TIMEOUT_DAYS: 'payment_issue_timeout_days',

  // Tier windows
  FLEXIBLE_WINDOW_MIN_DAYS: 'flexible_window_min_days',
  FLEXIBLE_WINDOW_MAX_DAYS: 'flexible_window_max_days',
  PRIORITY_WINDOW_DAYS: 'priority_window_days',
} as const;

// ============================================================================
// CONFIG OPERATIONS
// ============================================================================

/**
 * Get a config value by key
 */
export async function getConfig<T = unknown>(key: string): Promise<T | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('admin_config')
    .select('value')
    .eq('key', key)
    .single();

  if (error || !data) {
    return null;
  }

  return data.value as T;
}

/**
 * Get a config value with a default fallback
 */
export async function getConfigWithDefault<T>(key: string, defaultValue: T): Promise<T> {
  const value = await getConfig<T>(key);
  return value ?? defaultValue;
}

/**
 * Set a config value
 */
export async function setConfig(
  key: string,
  value: unknown,
  updatedBy?: string
): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('admin_config')
    .upsert({
      key,
      value,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy || null,
    });

  if (error) {
    throw new Error(`Failed to set config: ${error.message}`);
  }
}

/**
 * Get all config values
 */
export async function getAllConfig(): Promise<Record<string, unknown>> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('admin_config')
    .select('key, value');

  if (error) {
    throw new Error(`Failed to fetch config: ${error.message}`);
  }

  const config: Record<string, unknown> = {};
  for (const row of data || []) {
    config[row.key] = row.value;
  }

  return config;
}

// ============================================================================
// TYPED CONFIG GETTERS
// ============================================================================

/**
 * Get deposit payment window in hours
 */
export async function getDepositPaymentWindowHours(): Promise<number> {
  const value = await getConfig<string>(CONFIG_KEYS.DEPOSIT_PAYMENT_WINDOW_HOURS);
  return parseInt(value || '24', 10);
}

/**
 * Check if cancel window is enabled
 */
export async function isCancelWindowEnabled(): Promise<boolean> {
  const value = await getConfig<string>(CONFIG_KEYS.CANCEL_WINDOW_ENABLED);
  return value === 'true';
}

/**
 * Get cancel window duration in seconds
 */
export async function getCancelWindowSeconds(): Promise<number> {
  const value = await getConfig<string>(CONFIG_KEYS.CANCEL_WINDOW_SECONDS);
  return parseInt(value || '600', 10);
}

/**
 * Get payment issue timeout in days
 */
export async function getPaymentIssueTimeoutDays(): Promise<number> {
  const value = await getConfig<string>(CONFIG_KEYS.PAYMENT_ISSUE_TIMEOUT_DAYS);
  return parseInt(value || '7', 10);
}

/**
 * Get flexible tier window range in days
 */
export async function getFlexibleWindowDays(): Promise<{ min: number; max: number }> {
  const minValue = await getConfig<string>(CONFIG_KEYS.FLEXIBLE_WINDOW_MIN_DAYS);
  const maxValue = await getConfig<string>(CONFIG_KEYS.FLEXIBLE_WINDOW_MAX_DAYS);
  return {
    min: parseInt(minValue || '7', 10),
    max: parseInt(maxValue || '28', 10),
  };
}

/**
 * Get priority tier window in days
 */
export async function getPriorityWindowDays(): Promise<number> {
  const value = await getConfig<string>(CONFIG_KEYS.PRIORITY_WINDOW_DAYS);
  return parseInt(value || '14', 10);
}
