// Monitoring Bot Runner
// Entry point that monitors all DMV locations in parallel

import { monitorLocation, LOCATIONS, type LocationResult } from './monitoring-bot';

// ============================================================================
// CONFIGURATION
// ============================================================================

const PARALLEL_WORKERS = parseInt(process.env.DMV_PARALLEL_WORKERS || '4', 10);

// ============================================================================
// MAIN RUNNER
// ============================================================================

async function runMonitoringBot(): Promise<void> {
  console.log('[MonitoringBot] Starting monitoring run...');
  console.log(`[MonitoringBot] Monitoring ${LOCATIONS.length} locations with ${PARALLEL_WORKERS} parallel workers`);

  const startTime = Date.now();

  // Run locations in parallel batches
  const results: LocationResult[] = [];

  // Process in batches based on worker count
  for (let i = 0; i < LOCATIONS.length; i += PARALLEL_WORKERS) {
    const batch = LOCATIONS.slice(i, i + PARALLEL_WORKERS);
    console.log(`[MonitoringBot] Processing batch: ${batch.join(', ')}`);

    const batchResults = await Promise.all(
      batch.map((location) => monitorLocation(location))
    );

    results.push(...batchResults);
  }

  const duration = Date.now() - startTime;
  const successCount = results.filter((r) => r.ok).length;

  console.log(`[MonitoringBot] Completed in ${duration}ms`);
  console.log(`[MonitoringBot] Success: ${successCount}/${LOCATIONS.length} locations`);

  // Exit with error if any location failed
  if (successCount < LOCATIONS.length) {
    console.log('[MonitoringBot] Some locations failed, exiting with error');
    process.exit(1);
  }
}

// ============================================================================
// SINGLE LOCATION MODE
// ============================================================================

async function runSingleLocation(locationName: string): Promise<void> {
  console.log(`[MonitoringBot] Monitoring single location: ${locationName}`);

  const result = await monitorLocation(locationName);

  if (!result.ok) {
    console.log(`[MonitoringBot] Failed: ${result.reason}`);
    process.exit(1);
  }

  console.log(`[MonitoringBot] Success: ${result.dataVal}`);
}

// ============================================================================
// CLI ENTRY POINT
// ============================================================================

const args = process.argv.slice(2);

if (args.length > 0) {
  // Single location mode
  const locationArg = args.join(' ');
  const matchedLocation = LOCATIONS.find(
    (loc) => loc.toLowerCase().includes(locationArg.toLowerCase())
  );

  if (!matchedLocation) {
    console.error(`Unknown location: ${locationArg}`);
    console.error(`Available locations: ${LOCATIONS.join(', ')}`);
    process.exit(1);
  }

  runSingleLocation(matchedLocation).catch((error) => {
    console.error('[MonitoringBot] Fatal error:', error);
    process.exit(1);
  });
} else {
  // Full monitoring mode
  runMonitoringBot().catch((error) => {
    console.error('[MonitoringBot] Fatal error:', error);
    process.exit(1);
  });
}
