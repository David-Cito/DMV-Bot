"use strict";
// Bot Configuration for Booking Bot
// Loads configuration from database or uses defaults
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadBotConfig = loadBotConfig;
exports.getBotConfig = getBotConfig;
exports.clearBotConfigCache = clearBotConfigCache;
const queue_1 = require("../../packages/queue");
// ============================================================================
// DEFAULT VALUES
// ============================================================================
const DEFAULTS = {
    MAX_RETRIES: 3,
    RETRY_DELAY_MS: 1000,
    NAVIGATION_TIMEOUT_MS: 30000,
    ELEMENT_TIMEOUT_MS: 10000,
    BROWSER_CLOSE_TIMEOUT_MS: 5000,
    CANCEL_POLL_INTERVAL_MS: 5000,
    SLOT_LOCK_TTL_SECONDS: 300,
};
let cachedConfig = null;
/**
 * Load bot configuration from database
 * Caches the result for the duration of the bot run
 */
async function loadBotConfig() {
    if (cachedConfig) {
        return cachedConfig;
    }
    cachedConfig = {
        maxRetries: await (0, queue_1.getConfigWithDefault)('bot_max_retries', DEFAULTS.MAX_RETRIES),
        retryDelayMs: await (0, queue_1.getConfigWithDefault)('bot_retry_delay_ms', DEFAULTS.RETRY_DELAY_MS),
        navigationTimeoutMs: await (0, queue_1.getConfigWithDefault)('bot_navigation_timeout_ms', DEFAULTS.NAVIGATION_TIMEOUT_MS),
        elementTimeoutMs: await (0, queue_1.getConfigWithDefault)('bot_element_timeout_ms', DEFAULTS.ELEMENT_TIMEOUT_MS),
        browserCloseTimeoutMs: await (0, queue_1.getConfigWithDefault)('bot_browser_close_timeout_ms', DEFAULTS.BROWSER_CLOSE_TIMEOUT_MS),
        cancelPollIntervalMs: await (0, queue_1.getConfigWithDefault)('bot_cancel_poll_interval_ms', DEFAULTS.CANCEL_POLL_INTERVAL_MS),
        slotLockTtlSeconds: await (0, queue_1.getConfigWithDefault)('bot_slot_lock_ttl_seconds', DEFAULTS.SLOT_LOCK_TTL_SECONDS),
    };
    console.log('[BotConfig] Loaded configuration:', cachedConfig);
    return cachedConfig;
}
/**
 * Get cached config (must call loadBotConfig first)
 * Falls back to defaults if not loaded
 */
function getBotConfig() {
    if (cachedConfig) {
        return cachedConfig;
    }
    // Return defaults if config not loaded yet
    return {
        maxRetries: DEFAULTS.MAX_RETRIES,
        retryDelayMs: DEFAULTS.RETRY_DELAY_MS,
        navigationTimeoutMs: DEFAULTS.NAVIGATION_TIMEOUT_MS,
        elementTimeoutMs: DEFAULTS.ELEMENT_TIMEOUT_MS,
        browserCloseTimeoutMs: DEFAULTS.BROWSER_CLOSE_TIMEOUT_MS,
        cancelPollIntervalMs: DEFAULTS.CANCEL_POLL_INTERVAL_MS,
        slotLockTtlSeconds: DEFAULTS.SLOT_LOCK_TTL_SECONDS,
    };
}
/**
 * Clear cached config (useful for testing)
 */
function clearBotConfigCache() {
    cachedConfig = null;
}
