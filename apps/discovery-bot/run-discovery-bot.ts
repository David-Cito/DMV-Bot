// Discovery Bot Runner
// Entry point that scans all DMV locations and services to assess supply

import {
  discoverServiceSupply,
  ALL_LOCATIONS,
  DRIVER_LICENSE_LOCATIONS,
  SATELLITE_LOCATIONS,
  SATELLITE_DL_LOCATIONS,
  SATELLITE_OTHER_LOCATIONS,
  getUntrackedLocations,
  ALREADY_TRACKED_SERVICES,
  saveDiscoveryResults,
  generateSupplyReport,
  ensureDiscoveryDir,
  type DiscoveryRunResult,
  type LocationSupplyResult,
  type LocationConfig,
  type ServiceConfig,
} from './discovery-bot';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// CONFIGURATION
// ============================================================================

const PARALLEL_WORKERS = parseInt(process.env.DISCOVERY_PARALLEL_WORKERS || '6', 10);
const DATA_DIR = path.join(process.cwd(), 'data');
const DISCOVERY_DIR = path.join(DATA_DIR, 'discovery');

// ============================================================================
// MAIN RUNNER
// ============================================================================

async function runDiscoveryBot(
  locations: LocationConfig[]
): Promise<void> {
  console.log('[DiscoveryBot] Starting supply discovery run...');
  console.log(`[DiscoveryBot] Scanning ${locations.length} locations with ${PARALLEL_WORKERS} parallel workers`);

  const startTime = Date.now();
  const runAt = new Date().toISOString();

  const results: LocationSupplyResult[] = [];
  let totalServices = 0;
  let successfulScans = 0;
  let failedScans = 0;

  // Process in batches based on worker count
  for (let i = 0; i < locations.length; i += PARALLEL_WORKERS) {
    const batch = locations.slice(i, i + PARALLEL_WORKERS);
    console.log(`[DiscoveryBot] Processing batch ${Math.floor(i / PARALLEL_WORKERS) + 1}: ${batch.map(l => l.name).join(', ')}`);

    const batchResults = await Promise.all(
      batch.map((location) => discoverServiceSupply(location))
    );

    for (const result of batchResults) {
      results.push(result);
      for (const service of result.services) {
        totalServices += 1;
        if (service.ok) {
          successfulScans += 1;
        } else {
          failedScans += 1;
        }
      }
    }
  }

  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startTime;

  const runResult: DiscoveryRunResult = {
    runAt,
    completedAt,
    durationMs,
    totalLocations: locations.length,
    totalServices,
    successfulScans,
    failedScans,
    locations: results,
  };

  // Save results
  ensureDiscoveryDir();
  saveDiscoveryResults(runResult);

  // Generate and save report
  const report = generateSupplyReport(runResult);
  const reportPath = path.join(DISCOVERY_DIR, 'supply-report.md');
  fs.writeFileSync(reportPath, report, 'utf8');

  console.log(`\n[DiscoveryBot] Completed in ${Math.round(durationMs / 1000)}s`);
  console.log(`[DiscoveryBot] Scanned: ${totalServices} service combinations`);
  console.log(`[DiscoveryBot] Success: ${successfulScans}, Failed: ${failedScans}`);
  console.log(`[DiscoveryBot] Results saved to: ${DISCOVERY_DIR}`);
  console.log(`[DiscoveryBot] Report saved to: ${reportPath}`);

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log(report);
}

// ============================================================================
// CLI ENTRY POINT
// ============================================================================

const args = process.argv.slice(2);

function printUsage(): void {
  console.log('Usage: npx tsx run-discovery-bot.ts [options]');
  console.log('');
  console.log('Options:');
  console.log('  --all              Scan all locations (excludes already-tracked services)');
  console.log('  --include-tracked  Include services already tracked by monitoring bots');
  console.log('  --driver-license   Scan only driver license locations');
  console.log('  --satellite        Scan only satellite city halls');
  console.log('  --location <name>  Scan a specific location');
  console.log('  --help             Show this help message');
  console.log('');
  console.log('By default, excludes services already tracked by monitoring bots:');
  for (const tracked of ALREADY_TRACKED_SERVICES) {
    console.log(`  - ${tracked.locationCode}: ${tracked.servicePattern}`);
  }
  console.log('');
  console.log('Environment variables:');
  console.log('  DISCOVERY_PARALLEL_WORKERS  Number of parallel workers (default: 2)');
}

if (args.includes('--help')) {
  printUsage();
  process.exit(0);
}

const includeTracked = args.includes('--include-tracked');
let locationsToScan: LocationConfig[];

if (args.includes('--driver-license')) {
  locationsToScan = DRIVER_LICENSE_LOCATIONS;
  console.log('[DiscoveryBot] Mode: Driver License locations only');
} else if (args.includes('--satellite')) {
  locationsToScan = includeTracked ? SATELLITE_LOCATIONS : getUntrackedLocations().filter(
    (loc) => SATELLITE_LOCATIONS.some((s) => s.code === loc.code)
  );
  console.log('[DiscoveryBot] Mode: Satellite City Halls only');
} else if (args.includes('--location')) {
  const locationIdx = args.indexOf('--location');
  const locationArg = args[locationIdx + 1];
  if (!locationArg) {
    console.error('Error: --location requires a location name');
    process.exit(1);
  }

  const allLocs = includeTracked ? ALL_LOCATIONS : getUntrackedLocations();
  const matchedLocation = allLocs.find(
    (loc) => loc.name.toLowerCase().includes(locationArg.toLowerCase())
  );

  if (!matchedLocation) {
    console.error(`Unknown location: ${locationArg}`);
    console.error('Available locations:');
    for (const loc of ALL_LOCATIONS) {
      console.error(`  - ${loc.name} (${loc.code})`);
    }
    process.exit(1);
  }

  locationsToScan = [matchedLocation];
  console.log(`[DiscoveryBot] Mode: Single location - ${matchedLocation.name} (${matchedLocation.code})`);
} else {
  locationsToScan = includeTracked ? ALL_LOCATIONS : getUntrackedLocations();
  console.log('[DiscoveryBot] Mode: All locations');
}

if (!includeTracked) {
  console.log('[DiscoveryBot] Excluding already-tracked services (use --include-tracked to include)');
}

// Count total services to scan
const totalServices = locationsToScan.reduce((sum, loc) => sum + loc.services.length, 0);
console.log(`[DiscoveryBot] Will scan ${locationsToScan.length} locations, ${totalServices} services`);
console.log('');

runDiscoveryBot(locationsToScan).catch((error) => {
  console.error('[DiscoveryBot] Fatal error:', error);
  process.exit(1);
});
