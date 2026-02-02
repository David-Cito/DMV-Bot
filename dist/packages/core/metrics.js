"use strict";
// Metrics Helper for Queue System V2
// Simple timing and success/failure tracking
Object.defineProperty(exports, "__esModule", { value: true });
exports.startTimer = startTimer;
exports.endTimer = endTimer;
exports.measure = measure;
exports.summarizeMetrics = summarizeMetrics;
exports.logMetrics = logMetrics;
exports.createRateCounter = createRateCounter;
exports.recordSuccess = recordSuccess;
exports.recordFailure = recordFailure;
exports.getSuccessRate = getSuccessRate;
exports.logRateCounter = logRateCounter;
const supabase_client_1 = require("../db/supabase_client");
// ============================================================================
// TIMING HELPERS
// ============================================================================
/**
 * Create a step timer for measuring operation durations
 */
function startTimer(step) {
    return {
        step,
        startTime: Date.now(),
    };
}
/**
 * End a timer and log the duration
 */
function endTimer(timer, success = true) {
    const duration = Date.now() - timer.startTime;
    const metric = {
        operation: timer.step,
        duration_ms: duration,
        success,
    };
    // Log to console
    const status = success ? 'OK' : 'FAIL';
    console.log(`[Metrics] ${timer.step}: ${duration}ms [${status}]`);
    return metric;
}
/**
 * Measure an async operation and return its result with timing
 */
async function measure(operation, fn) {
    const timer = startTimer(operation);
    try {
        const result = await fn();
        const metric = endTimer(timer, true);
        return { result, metric };
    }
    catch (error) {
        endTimer(timer, false);
        throw error;
    }
}
/**
 * Collect and summarize metrics for a bot run
 */
function summarizeMetrics(botRunId, steps) {
    const totalDuration = steps.reduce((sum, s) => sum + s.duration_ms, 0);
    const successCount = steps.filter((s) => s.success).length;
    const successRate = steps.length > 0 ? successCount / steps.length : 1;
    return {
        bot_run_id: botRunId,
        steps,
        total_duration_ms: totalDuration,
        success_rate: successRate,
    };
}
/**
 * Log metrics to database for analysis
 */
async function logMetrics(botRunId, metricType, metrics) {
    try {
        const supabase = (0, supabase_client_1.getSupabaseClient)();
        await supabase.from('bot_metrics').insert({
            bot_run_id: botRunId,
            metric_type: metricType,
            metrics,
            created_at: new Date().toISOString(),
        });
    }
    catch (error) {
        // Don't fail the operation if metrics logging fails
        console.error(`[Metrics] Failed to log metrics: ${error.message}`);
    }
}
/**
 * Create a rate counter for tracking success/failure rates
 */
function createRateCounter(name) {
    return {
        name,
        successes: 0,
        failures: 0,
    };
}
/**
 * Record a success
 */
function recordSuccess(counter) {
    counter.successes++;
}
/**
 * Record a failure
 */
function recordFailure(counter) {
    counter.failures++;
}
/**
 * Get success rate as a percentage
 */
function getSuccessRate(counter) {
    const total = counter.successes + counter.failures;
    if (total === 0)
        return 100;
    return (counter.successes / total) * 100;
}
/**
 * Log rate counter summary
 */
function logRateCounter(counter) {
    const total = counter.successes + counter.failures;
    const rate = getSuccessRate(counter);
    console.log(`[Metrics] ${counter.name}: ${counter.successes}/${total} (${rate.toFixed(1)}% success)`);
}
//# sourceMappingURL=metrics.js.map