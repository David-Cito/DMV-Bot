// Circuit Breaker Pattern for Queue System V2
// Prevents hammering external services when they're down

// ============================================================================
// TYPES
// ============================================================================

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** Time in ms before attempting to close the circuit */
  resetTimeoutMs: number;
  /** Number of successful calls in half-open state to close the circuit */
  successThreshold: number;
}

export interface CircuitBreaker {
  name: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
  config: CircuitBreakerConfig;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,      // Open after 5 failures
  resetTimeoutMs: 60000,    // Try again after 1 minute
  successThreshold: 2,       // Close after 2 successes in half-open
};

// ============================================================================
// CIRCUIT BREAKER REGISTRY
// ============================================================================

const circuits: Map<string, CircuitBreaker> = new Map();

/**
 * Get or create a circuit breaker by name
 */
export function getCircuitBreaker(
  name: string,
  config: Partial<CircuitBreakerConfig> = {}
): CircuitBreaker {
  let circuit = circuits.get(name);

  if (!circuit) {
    circuit = {
      name,
      state: 'closed',
      failureCount: 0,
      successCount: 0,
      lastFailureTime: null,
      config: { ...DEFAULT_CONFIG, ...config },
    };
    circuits.set(name, circuit);
  }

  return circuit;
}

/**
 * Check if a circuit allows requests
 */
export function isCircuitOpen(name: string): boolean {
  const circuit = circuits.get(name);
  if (!circuit) return false;

  // Check if we should transition from open to half-open
  if (circuit.state === 'open' && circuit.lastFailureTime) {
    const elapsed = Date.now() - circuit.lastFailureTime;
    if (elapsed >= circuit.config.resetTimeoutMs) {
      circuit.state = 'half-open';
      circuit.successCount = 0;
      console.log(`[CircuitBreaker] ${name}: open -> half-open (reset timeout elapsed)`);
    }
  }

  return circuit.state === 'open';
}

/**
 * Record a successful call
 */
export function recordCircuitSuccess(name: string): void {
  const circuit = circuits.get(name);
  if (!circuit) return;

  if (circuit.state === 'half-open') {
    circuit.successCount++;
    console.log(`[CircuitBreaker] ${name}: success in half-open (${circuit.successCount}/${circuit.config.successThreshold})`);

    if (circuit.successCount >= circuit.config.successThreshold) {
      circuit.state = 'closed';
      circuit.failureCount = 0;
      circuit.successCount = 0;
      console.log(`[CircuitBreaker] ${name}: half-open -> closed`);
    }
  } else if (circuit.state === 'closed') {
    // Reset failure count on success
    circuit.failureCount = 0;
  }
}

/**
 * Record a failed call
 */
export function recordCircuitFailure(name: string): void {
  const circuit = circuits.get(name);
  if (!circuit) return;

  circuit.failureCount++;
  circuit.lastFailureTime = Date.now();

  if (circuit.state === 'half-open') {
    // Any failure in half-open reopens the circuit
    circuit.state = 'open';
    console.log(`[CircuitBreaker] ${name}: half-open -> open (failure during probe)`);
  } else if (circuit.state === 'closed') {
    if (circuit.failureCount >= circuit.config.failureThreshold) {
      circuit.state = 'open';
      console.log(`[CircuitBreaker] ${name}: closed -> open (${circuit.failureCount} failures)`);
    }
  }
}

/**
 * Execute a function with circuit breaker protection
 */
export async function withCircuitBreaker<T>(
  name: string,
  fn: () => Promise<T>,
  config: Partial<CircuitBreakerConfig> = {}
): Promise<T> {
  // Ensure circuit exists
  getCircuitBreaker(name, config);

  // Check if circuit is open
  if (isCircuitOpen(name)) {
    throw new Error(`Circuit breaker '${name}' is open - service unavailable`);
  }

  try {
    const result = await fn();
    recordCircuitSuccess(name);
    return result;
  } catch (error) {
    recordCircuitFailure(name);
    throw error;
  }
}

/**
 * Get circuit breaker status for monitoring
 */
export function getCircuitStatus(name: string): {
  state: CircuitState;
  failureCount: number;
  lastFailure: Date | null;
  timeUntilRetry: number | null;
} | null {
  const circuit = circuits.get(name);
  if (!circuit) return null;

  let timeUntilRetry: number | null = null;
  if (circuit.state === 'open' && circuit.lastFailureTime) {
    const elapsed = Date.now() - circuit.lastFailureTime;
    timeUntilRetry = Math.max(0, circuit.config.resetTimeoutMs - elapsed);
  }

  return {
    state: circuit.state,
    failureCount: circuit.failureCount,
    lastFailure: circuit.lastFailureTime ? new Date(circuit.lastFailureTime) : null,
    timeUntilRetry,
  };
}

/**
 * Reset a circuit breaker (for testing)
 */
export function resetCircuit(name: string): void {
  const circuit = circuits.get(name);
  if (circuit) {
    circuit.state = 'closed';
    circuit.failureCount = 0;
    circuit.successCount = 0;
    circuit.lastFailureTime = null;
  }
}

/**
 * Clear all circuit breakers (for testing)
 */
export function clearAllCircuits(): void {
  circuits.clear();
}
