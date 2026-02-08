"use strict";
// Road Test Bot Runner
// Entry point for road test appointment monitoring
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const road_test_bot_1 = require("./road-test-bot");
function parseArgs() {
    const args = process.argv.slice(2);
    let mode = 'monitor'; // Default to monitoring
    let headless = process.env.CI === 'true';
    let days = 45; // Default to 45 days
    let upload = false;
    let verbose = process.env.ROAD_TEST_VERBOSE === 'true';
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--discover' || arg === '-d') {
            mode = 'discover';
        }
        else if (arg === '--monitor' || arg === '-m') {
            mode = 'monitor';
        }
        else if (arg === '--test' || arg === '-t') {
            mode = 'test';
        }
        else if (arg === '--headless') {
            headless = true;
        }
        else if (arg === '--headed' || arg === '--visible') {
            headless = false;
        }
        else if (arg === '--upload' || arg === '-u') {
            upload = true;
        }
        else if (arg === '--verbose' || arg === '-v') {
            verbose = true;
        }
        else if (arg === '--days' && args[i + 1]) {
            days = parseInt(args[i + 1], 10);
            i++; // Skip next arg
        }
        else if (arg.startsWith('--days=')) {
            days = parseInt(arg.split('=')[1], 10);
        }
    }
    return { mode, headless, days, upload, verbose };
}
// ============================================================================
// DISCOVERY MODE
// ============================================================================
async function runDiscoveryMode(headless) {
    console.log('='.repeat(60));
    console.log('ROAD TEST BOT - DISCOVERY MODE');
    console.log('='.repeat(60));
    console.log();
    console.log('This mode explores the road test scheduling site to map its structure.');
    console.log('Screenshots and analysis will be saved to data/screenshots/');
    console.log();
    await (0, road_test_bot_1.runDiscovery)({ headless });
    console.log();
    console.log('='.repeat(60));
    console.log('Discovery complete. Review screenshots and analysis.');
    console.log('='.repeat(60));
}
// ============================================================================
// MONITORING MODE
// ============================================================================
async function runMonitoringMode(headless, days, upload, verbose) {
    console.log('='.repeat(60));
    console.log('ROAD TEST BOT - MONITORING MODE');
    console.log('='.repeat(60));
    console.log();
    console.log(`Locations: ${road_test_bot_1.LOCATIONS.join(', ')}`);
    console.log(`Scan window: ${days} days`);
    console.log(`Upload to Supabase: ${upload}`);
    if (verbose)
        console.log(`Verbose logging: enabled`);
    console.log();
    const startTime = Date.now();
    const result = await (0, road_test_bot_1.monitorRoadTest)({ headless, scanDays: days, verbose });
    const durationMs = Date.now() - startTime;
    result.durationMs = durationMs;
    console.log(`\n[Monitor] Completed in ${durationMs}ms`);
    // Display results
    console.log('\n' + '='.repeat(60));
    console.log('RESULTS');
    console.log('='.repeat(60));
    console.log();
    console.log((0, road_test_bot_1.formatResultMessage)(result));
    // Check for instant alert condition
    if (result.summary.earliestDaysAway !== null && result.summary.earliestDaysAway <= road_test_bot_1.INSTANT_ALERT_DAYS) {
        console.log();
        console.log('!'.repeat(60));
        console.log('INSTANT ALERT TRIGGERED');
        console.log(`Appointment available in ${result.summary.earliestDaysAway} days (threshold: ${road_test_bot_1.INSTANT_ALERT_DAYS})`);
        console.log('!'.repeat(60));
    }
    // Upload to Supabase if requested
    if (upload) {
        console.log('\n' + '='.repeat(60));
        console.log('UPLOADING TO SUPABASE');
        console.log('='.repeat(60));
        const uploadResult = await (0, road_test_bot_1.uploadResultsToSupabase)(result);
        // Add changes to result for notification script
        if (uploadResult.success && uploadResult.changes) {
            result.changes = uploadResult.changes;
            console.log(`[Monitor] Changes: ${uploadResult.changes.newSlots} new, ${uploadResult.changes.reactivatedSlots} reactivated, ${uploadResult.changes.disappearedSlots} disappeared`);
        }
    }
    // Exit with error if scan failed
    if (!result.ok) {
        console.log('\n[Monitor] Scan failed, exiting with error');
        process.exit(1);
    }
}
// ============================================================================
// TEST MODE
// ============================================================================
async function runTestMode(headless) {
    console.log('='.repeat(60));
    console.log('ROAD TEST BOT - TEST MODE');
    console.log('='.repeat(60));
    console.log();
    console.log('Running a quick test to verify site accessibility...');
    console.log();
    const { chromium } = await Promise.resolve().then(() => __importStar(require('playwright')));
    const browser = await chromium.launch({ headless, slowMo: 500 });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
        locale: 'en-US',
        timezoneId: 'Pacific/Honolulu',
    });
    const page = await context.newPage();
    try {
        const START_URL = 'https://www12.honolulu.gov/csdarts/frmApptInt.aspx';
        console.log(`[Test] Navigating to: ${START_URL}`);
        const response = await page.goto(START_URL, { timeout: 60000, waitUntil: 'domcontentloaded' });
        console.log(`[Test] Status: ${response?.status()}`);
        console.log(`[Test] URL: ${page.url()}`);
        const title = await page.title();
        console.log(`[Test] Title: ${title}`);
        // Quick structure check
        const hasTable = await page.$('table') !== null;
        const hasCalendar = await page.$('#Calendar1, [id*="Calendar"]') !== null;
        const hasAppointmentTable = await page.$('th:has-text("Kapahulu"), th:has-text("Time")') !== null;
        console.log(`[Test] Has table: ${hasTable}`);
        console.log(`[Test] Has calendar: ${hasCalendar}`);
        console.log(`[Test] Has appointment table: ${hasAppointmentTable}`);
        // Check for CAPTCHA
        const pageText = await page.evaluate(`document.body?.innerText?.slice(0, 500) || ''`);
        const hasCaptcha = pageText.toLowerCase().includes('captcha') || pageText.toLowerCase().includes('automated spam');
        console.log(`[Test] CAPTCHA detected: ${hasCaptcha}`);
        if (hasCaptcha) {
            console.log('\n[Test] WARNING: Site has CAPTCHA protection');
        }
        else {
            console.log('\n[Test] Site is accessible!');
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[Test] Error: ${errorMessage}`);
        process.exit(1);
    }
    finally {
        await context.close();
        await browser.close();
    }
}
// ============================================================================
// MAIN ENTRY POINT
// ============================================================================
async function main() {
    const { mode, headless, days, upload, verbose } = parseArgs();
    console.log(`[RoadTestBot] Mode: ${mode}`);
    console.log(`[RoadTestBot] Headless: ${headless}`);
    console.log(`[RoadTestBot] Days: ${days}`);
    console.log(`[RoadTestBot] Upload: ${upload}`);
    if (verbose)
        console.log(`[RoadTestBot] Verbose: ${verbose}`);
    console.log();
    switch (mode) {
        case 'discover':
            await runDiscoveryMode(headless);
            break;
        case 'monitor':
            await runMonitoringMode(headless, days, upload, verbose);
            break;
        case 'test':
            await runTestMode(headless);
            break;
        default:
            console.error(`Unknown mode: ${mode}`);
            console.log('\nUsage:');
            console.log('  npx ts-node apps/road-test-bot/run-road-test-bot.ts [options]');
            console.log('\nOptions:');
            console.log('  --discover, -d    Run discovery mode');
            console.log('  --monitor, -m     Run monitoring mode (default)');
            console.log('  --test, -t        Quick connectivity test');
            console.log('  --headless        Run without visible browser');
            console.log('  --headed          Run with visible browser');
            console.log('  --days=N          Scan N days ahead (default: 45)');
            console.log('  --upload, -u      Upload results to Supabase');
            console.log('  --verbose, -v     Enable detailed diagnostic logging');
            process.exit(1);
    }
}
main().catch((error) => {
    console.error('[RoadTestBot] Fatal error:', error);
    process.exit(1);
});
