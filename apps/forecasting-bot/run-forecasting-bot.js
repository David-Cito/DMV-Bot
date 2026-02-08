"use strict";
// Forecasting Bot Runner
// Entry point that scans days 31-60 for prediction data
Object.defineProperty(exports, "__esModule", { value: true });
const forecasting_bot_1 = require("./forecasting-bot");
// ============================================================================
// CONFIGURATION
// ============================================================================
const PARALLEL_WORKERS = parseInt(process.env.DMV_PARALLEL_WORKERS || '4', 10);
// ============================================================================
// MAIN RUNNER
// ============================================================================
async function runForecastingBot() {
    console.log('[ForecastingBot] Starting forecast run...');
    console.log(`[ForecastingBot] Scanning days 31-60 for ${forecasting_bot_1.LOCATIONS.length} locations with ${PARALLEL_WORKERS} parallel workers`);
    const startTime = Date.now();
    // Run locations in parallel batches
    const results = [];
    // Process in batches based on worker count
    for (let i = 0; i < forecasting_bot_1.LOCATIONS.length; i += PARALLEL_WORKERS) {
        const batch = forecasting_bot_1.LOCATIONS.slice(i, i + PARALLEL_WORKERS);
        console.log(`[ForecastingBot] Processing batch: ${batch.join(', ')}`);
        const batchResults = await Promise.all(batch.map((location) => (0, forecasting_bot_1.forecastLocation)(location)));
        results.push(...batchResults);
    }
    const duration = Date.now() - startTime;
    const successCount = results.filter((r) => r.ok).length;
    console.log(`[ForecastingBot] Completed in ${duration}ms`);
    console.log(`[ForecastingBot] Success: ${successCount}/${forecasting_bot_1.LOCATIONS.length} locations`);
    // Exit with error if any location failed
    if (successCount < forecasting_bot_1.LOCATIONS.length) {
        console.log('[ForecastingBot] Some locations failed, exiting with error');
        process.exit(1);
    }
}
// ============================================================================
// SINGLE LOCATION MODE
// ============================================================================
async function runSingleLocation(locationName) {
    console.log(`[ForecastingBot] Forecasting single location: ${locationName}`);
    const result = await (0, forecasting_bot_1.forecastLocation)(locationName);
    if (!result.ok) {
        console.log(`[ForecastingBot] Failed: ${result.reason}`);
        process.exit(1);
    }
    console.log(`[ForecastingBot] Success: ${result.dataVal}`);
}
// ============================================================================
// CLI ENTRY POINT
// ============================================================================
const args = process.argv.slice(2);
if (args.length > 0) {
    // Single location mode
    const locationArg = args.join(' ');
    const matchedLocation = forecasting_bot_1.LOCATIONS.find((loc) => loc.toLowerCase().includes(locationArg.toLowerCase()));
    if (!matchedLocation) {
        console.error(`Unknown location: ${locationArg}`);
        console.error(`Available locations: ${forecasting_bot_1.LOCATIONS.join(', ')}`);
        process.exit(1);
    }
    runSingleLocation(matchedLocation).catch((error) => {
        console.error('[ForecastingBot] Fatal error:', error);
        process.exit(1);
    });
}
else {
    // Full forecast mode
    runForecastingBot().catch((error) => {
        console.error('[ForecastingBot] Fatal error:', error);
        process.exit(1);
    });
}
