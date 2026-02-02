// Metrics Helper for Queue System V2
// Simple timing and success/failure tracking

import { getSupabaseClient } from '../db/supabase_client';

// ============================================================================
// TYPES
// ============================================================================

export interface TimingMetric {
  operation: string;
  duration_ms: number;
  success: boolean;
  metadata?: Record<string, unknown>;
}

export interface StepTimer {
  step: string;
  startTime: number;
}

// ============================================================================
// TIMING HELPERS
// ============================================================================

/**
 * Create a step timer for measuring operation durations
 */
export function startTimer(step: string): StepTimer {
  return {
    step,
    startTime: Date.now(),
  };
}

/**
 * End a timer and log the duration
 */
export function endTimer(timer: StepTimer, success: boolean = true): TimingMetric {
  const duration = Date.now() - timer.startTime;
  const metric: TimingMetric = {
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
export async function measure<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<{ result: T; metric: TimingMetric }> {
  const timer = startTimer(operation);
  try {
    const result = await fn();
    const metric = endTimer(timer, true);
    return { result, metric };
  } catch (error) {
    endTimer(timer, false);
    throw error;
  }
}

// ============================================================================
// BOT RUN METRICS
// ============================================================================

export interface BotRunMetrics {
  bot_run_id: string;
  steps: TimingMetric[];
  total_duration_ms: number;
  success_rate: number;
}

/**
 * Collect and summarize metrics for a bot run
 */
export function summarizeMetrics(botRunId: string, steps: TimingMetric[]): BotRunMetrics {
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
export async function logMetrics(
  botRunId: string,
  metricType: string,
  metrics: Record<string, unknown>
): Promise<void> {
  try {
    const supabase = getSupabaseClient();

    await supabase.from('bot_metrics').insert({
      bot_run_id: botRunId,
      metric_type: metricType,
      metrics,
      created_at: new Date().toISOString(),
    });
  } catch (error: any) {
    // Don't fail the operation if metrics logging fails
    console.error(`[Metrics] Failed to log metrics: ${error.message}`);
  }
}

// ============================================================================
// RATE TRACKING
// ============================================================================

export interface RateCounter {
  name: string;
  successes: number;
  failures: number;
}

/**
 * Create a rate counter for tracking success/failure rates
 */
export function createRateCounter(name: string): RateCounter {
  return {
    name,
    successes: 0,
    failures: 0,
  };
}

/**
 * Record a success
 */
export function recordSuccess(counter: RateCounter): void {
  counter.successes++;
}

/**
 * Record a failure
 */
export function recordFailure(counter: RateCounter): void {
  counter.failures++;
}

/**
 * Get success rate as a percentage
 */
export function getSuccessRate(counter: RateCounter): number {
  const total = counter.successes + counter.failures;
  if (total === 0) return 100;
  return (counter.successes / total) * 100;
}

/**
 * Log rate counter summary
 */
export function logRateCounter(counter: RateCounter): void {
  const total = counter.successes + counter.failures;
  const rate = getSuccessRate(counter);
  console.log(`[Metrics] ${counter.name}: ${counter.successes}/${total} (${rate.toFixed(1)}% success)`);
}
