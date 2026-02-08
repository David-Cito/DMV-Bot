"use strict";
// Config Service for Queue System V2
// See openspec/specs/analytics/spec.md - Runtime Configuration
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONFIG_KEYS = void 0;
exports.getConfig = getConfig;
exports.getConfigWithDefault = getConfigWithDefault;
exports.setConfig = setConfig;
exports.getAllConfig = getAllConfig;
exports.getDepositPaymentWindowHours = getDepositPaymentWindowHours;
exports.isCancelWindowEnabled = isCancelWindowEnabled;
exports.getCancelWindowSeconds = getCancelWindowSeconds;
exports.getPaymentIssueTimeoutDays = getPaymentIssueTimeoutDays;
exports.getFlexibleWindowDays = getFlexibleWindowDays;
exports.getPriorityWindowDays = getPriorityWindowDays;
const supabase_client_1 = require("../db/supabase_client");
// ============================================================================
// CONFIG KEYS
// ============================================================================
exports.CONFIG_KEYS = {
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
};
// ============================================================================
// CONFIG OPERATIONS
// ============================================================================
/**
 * Get a config value by key
 */
async function getConfig(key) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('admin_config')
        .select('value')
        .eq('key', key)
        .single();
    if (error || !data) {
        return null;
    }
    return data.value;
}
/**
 * Get a config value with a default fallback
 */
async function getConfigWithDefault(key, defaultValue) {
    const value = await getConfig(key);
    return value ?? defaultValue;
}
/**
 * Set a config value
 */
async function setConfig(key, value, updatedBy) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
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
async function getAllConfig() {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    const { data, error } = await supabase
        .from('admin_config')
        .select('key, value');
    if (error) {
        throw new Error(`Failed to fetch config: ${error.message}`);
    }
    const config = {};
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
async function getDepositPaymentWindowHours() {
    const value = await getConfig(exports.CONFIG_KEYS.DEPOSIT_PAYMENT_WINDOW_HOURS);
    return parseInt(value || '24', 10);
}
/**
 * Check if cancel window is enabled
 */
async function isCancelWindowEnabled() {
    const value = await getConfig(exports.CONFIG_KEYS.CANCEL_WINDOW_ENABLED);
    return value === 'true';
}
/**
 * Get cancel window duration in seconds
 */
async function getCancelWindowSeconds() {
    const value = await getConfig(exports.CONFIG_KEYS.CANCEL_WINDOW_SECONDS);
    return parseInt(value || '600', 10);
}
/**
 * Get payment issue timeout in days
 */
async function getPaymentIssueTimeoutDays() {
    const value = await getConfig(exports.CONFIG_KEYS.PAYMENT_ISSUE_TIMEOUT_DAYS);
    return parseInt(value || '7', 10);
}
/**
 * Get flexible tier window range in days
 */
async function getFlexibleWindowDays() {
    const minValue = await getConfig(exports.CONFIG_KEYS.FLEXIBLE_WINDOW_MIN_DAYS);
    const maxValue = await getConfig(exports.CONFIG_KEYS.FLEXIBLE_WINDOW_MAX_DAYS);
    return {
        min: parseInt(minValue || '7', 10),
        max: parseInt(maxValue || '28', 10),
    };
}
/**
 * Get priority tier window in days
 */
async function getPriorityWindowDays() {
    const value = await getConfig(exports.CONFIG_KEYS.PRIORITY_WINDOW_DAYS);
    return parseInt(value || '14', 10);
}
