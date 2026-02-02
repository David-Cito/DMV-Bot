"use strict";
// Monitoring Bot Runner
// Entry point that monitors all DMV locations in parallel
Object.defineProperty(exports, "__esModule", { value: true });
const monitoring_bot_1 = require("./monitoring-bot");
// ============================================================================
// CONFIGURATION
// ============================================================================
const PARALLEL_WORKERS = parseInt(process.env.DMV_PARALLEL_WORKERS || '4', 10);
// ============================================================================
// MAIN RUNNER
// ============================================================================
async function runMonitoringBot() {
    console.log('[MonitoringBot] Starting monitoring run...');
    console.log(`[MonitoringBot] Monitoring ${monitoring_bot_1.LOCATIONS.length} locations with ${PARALLEL_WORKERS} parallel workers`);
    const startTime = Date.now();
    // Run locations in parallel batches
    const results = [];
    // Process in batches based on worker count
    for (let i = 0; i < monitoring_bot_1.LOCATIONS.length; i += PARALLEL_WORKERS) {
        const batch = monitoring_bot_1.LOCATIONS.slice(i, i + PARALLEL_WORKERS);
        console.log(`[MonitoringBot] Processing batch: ${batch.join(', ')}`);
        const batchResults = await Promise.all(batch.map((location) => (0, monitoring_bot_1.monitorLocation)(location)));
        results.push(...batchResults);
    }
    const duration = Date.now() - startTime;
    const successCount = results.filter((r) => r.ok).length;
    console.log(`[MonitoringBot] Completed in ${duration}ms`);
    console.log(`[MonitoringBot] Success: ${successCount}/${monitoring_bot_1.LOCATIONS.length} locations`);
    // Exit with error if any location failed
    if (successCount < monitoring_bot_1.LOCATIONS.length) {
        console.log('[MonitoringBot] Some locations failed, exiting with error');
        process.exit(1);
    }
}
// ============================================================================
// SINGLE LOCATION MODE
// ============================================================================
async function runSingleLocation(locationName) {
    console.log(`[MonitoringBot] Monitoring single location: ${locationName}`);
    const result = await (0, monitoring_bot_1.monitorLocation)(locationName);
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
    const matchedLocation = monitoring_bot_1.LOCATIONS.find((loc) => loc.toLowerCase().includes(locationArg.toLowerCase()));
    if (!matchedLocation) {
        console.error(`Unknown location: ${locationArg}`);
        console.error(`Available locations: ${monitoring_bot_1.LOCATIONS.join(', ')}`);
        process.exit(1);
    }
    runSingleLocation(matchedLocation).catch((error) => {
        console.error('[MonitoringBot] Fatal error:', error);
        process.exit(1);
    });
}
else {
    // Full monitoring mode
    runMonitoringBot().catch((error) => {
        console.error('[MonitoringBot] Fatal error:', error);
        process.exit(1);
    });
}
//# sourceMappingURL=run-monitoring-bot.js.map