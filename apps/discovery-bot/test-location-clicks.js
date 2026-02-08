"use strict";
// Test script to verify location clicking and verification
// Uses data-loc-val to select, data-loc-nam-val to verify
Object.defineProperty(exports, "__esModule", { value: true });
const playwright_1 = require("playwright");
const START_URL = 'https://alohaq.honolulu.gov/';
// All locations from the HTML with their codes and expected names
const LOCATION_MAP = [
    // Driver License locations (green)
    { code: 'CCDL', name: 'Commercial Drivers License (CDL)' },
    { code: 'KAPA', name: 'Kapālama Driver License, State ID' },
    { code: 'KAPO', name: 'Kapolei Driver License, State ID' },
    { code: 'KOOL', name: 'Koolau Driver License, State ID' },
    { code: 'WADL', name: 'Wahiawa Driver License, State ID' },
    { code: 'WAIA', name: 'Waianae Driver License, State ID' },
    // Satellite City Halls - DL renewals (blue)
    { code: 'FSCH', name: 'Downtown Satellite City Hall' },
    { code: 'HKAI', name: 'Hawaii Kai Satellite City Hall' },
    { code: 'PEAR', name: 'Pearlridge Satellite City Hall' },
    { code: 'WIND', name: 'Windward City Satellite City Hall' },
    // Satellite City Halls - Other (dark blue)
    { code: 'ALAM', name: 'Ala Moana Satellite City Hall' },
    { code: 'KSCH', name: 'Kapālama Satellite City Hall' },
    { code: 'KAPS', name: 'Kapolei Satellite City Hall' },
    { code: 'WAHI', name: 'Wahiawa Satellite City Hall' },
    { code: 'WAIS', name: 'Waianae Satellite City Hall' },
];
async function navigateToLocationSelection(page) {
    console.log('  [NAV] Going to start URL...');
    await page.goto(START_URL, { waitUntil: 'domcontentloaded' });
    console.log('  [NAV] Clicking Driver Licensing...');
    await page.getByText('Driver Licensing and').click();
    console.log('  [NAV] Waiting for #start...');
    await page.locator('#start').waitFor({ state: 'visible', timeout: 60_000 });
    console.log('  [NAV] Clicking Make Appointment...');
    const makeApptButton = page.locator('#newAppointment');
    await makeApptButton.waitFor({ state: 'visible', timeout: 60_000 });
    await makeApptButton.click();
    console.log('  [NAV] Waiting for #location container...');
    await page.waitForSelector('#location', { state: 'visible', timeout: 30_000 });
    // Wait for actual location tiles to load (not just the container)
    console.log('  [NAV] Waiting for location tiles to load...');
    await page.waitForSelector('.location.button-look.next[data-loc-val]', { state: 'visible', timeout: 60_000 });
    // Wait for spinner inside #location to hide
    const locationSpinner = page.locator('#location .fa-cog, #location .loading');
    await locationSpinner.waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => { });
    const currentUrl = page.url();
    console.log(`  [NAV] Location tiles loaded. URL: ${currentUrl}`);
}
async function testLocation(page, locationCode) {
    const expected = LOCATION_MAP.find(l => l.code === locationCode);
    const result = {
        code: locationCode,
        expectedName: expected?.name || 'Unknown',
        actualName: '',
        verified: false,
        clicked: false,
        servicesFound: [],
    };
    try {
        // Navigate to location selection page
        await navigateToLocationSelection(page);
        // Debug: Check what's in the #location container
        const locationContainerHTML = await page.$eval('#location', (el) => el.innerHTML.slice(0, 500)).catch(() => 'not found');
        console.log(`  [DEBUG] #location HTML preview: ${locationContainerHTML.slice(0, 200)}...`);
        // Debug: List all location tiles found
        const allLocations = await page.$$eval('.location.button-look.next[data-loc-val]', (els) => els.map(el => ({
            code: el.getAttribute('data-loc-val'),
            name: el.getAttribute('data-loc-nam-val'),
        })));
        console.log(`  [DEBUG] Found ${allLocations.length} location tiles with data-loc-val`);
        // Try alternate selector without data-loc-val
        const allLocationButtons = await page.$$eval('.location.button-look', (els) => els.map(el => ({
            id: el.id,
            class: el.className,
            text: (el.textContent || '').slice(0, 40),
        })));
        console.log(`  [DEBUG] Found ${allLocationButtons.length} .location.button-look elements`);
        for (const loc of allLocationButtons.slice(0, 5)) {
            console.log(`    ${loc.id}: ${loc.text}`);
        }
        // Find location using data-loc-val
        const selector = `.location.button-look.next[data-loc-val="${locationCode}"]`;
        const locationTile = page.locator(selector);
        // Check if element exists
        const count = await locationTile.count();
        if (count === 0) {
            result.error = `Location element not found: ${selector}`;
            return result;
        }
        // VERIFY: Read data-loc-nam-val to confirm correct location
        const actualName = await locationTile.getAttribute('data-loc-nam-val') || '';
        result.actualName = actualName;
        // Verify the code matches what we expect
        const actualCode = await locationTile.getAttribute('data-loc-val') || '';
        if (actualCode === locationCode) {
            result.verified = true;
        }
        console.log(`  [SELECT] data-loc-val="${actualCode}"`);
        console.log(`  [VERIFY] data-loc-nam-val="${actualName}"`);
        console.log(`  [STATUS] ${result.verified ? '✓ VERIFIED' : '✗ NOT VERIFIED'}`);
        // Click the location
        await locationTile.click();
        result.clicked = true;
        console.log(`  [CLICK] Location clicked`);
        // Wait for #transaction container to load
        console.log(`  [SERVICES] Waiting for #transaction...`);
        await page.waitForSelector('#transaction', { state: 'visible', timeout: 30_000 });
        // Wait for transaction buttons to appear
        await page.waitForSelector('.transaction.button-look[data-trans-val]', { state: 'visible', timeout: 30_000 });
        // Wait for any spinner to hide
        const spinner = page.locator('.fa-cog.fa-spin');
        await spinner.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => { });
        // Get all services/transactions
        const services = await page.$$eval('.transaction.button-look[data-trans-val]', (els) => els.map(el => ({
            name: el.getAttribute('data-trans-name') || '',
            val: el.getAttribute('data-trans-val') || '',
            type: el.getAttribute('data-trans-type') || '',
            disabled: el.classList.contains('btn-disabled'),
        })));
        result.servicesFound = services.map(s => s.name);
        console.log(`  [SERVICES] Found ${services.length} services:`);
        for (const svc of services) {
            const status = svc.disabled ? '(disabled)' : '';
            console.log(`    [${svc.val}] ${svc.name} ${status}`);
        }
    }
    catch (error) {
        result.error = error?.message || String(error);
        console.log(`  [ERROR] ${result.error}`);
    }
    return result;
}
async function main() {
    const args = process.argv.slice(2);
    // Determine which locations to test
    let locationsToTest = LOCATION_MAP;
    if (args.length > 0) {
        const searchTerm = args.join(' ').toUpperCase();
        locationsToTest = LOCATION_MAP.filter(loc => loc.code.includes(searchTerm) || loc.name.toUpperCase().includes(searchTerm));
    }
    if (locationsToTest.length === 0) {
        console.log('No matching locations. Available:');
        for (const loc of LOCATION_MAP) {
            console.log(`  ${loc.code}: ${loc.name}`);
        }
        return;
    }
    console.log(`\nTesting ${locationsToTest.length} location(s)...\n`);
    const browser = await playwright_1.chromium.launch({
        headless: process.env.CI === 'true',
        slowMo: 300,
    });
    const results = [];
    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        for (const location of locationsToTest) {
            console.log(`${'─'.repeat(60)}`);
            console.log(`Testing: ${location.code} - ${location.name}`);
            console.log(`${'─'.repeat(60)}`);
            const result = await testLocation(page, location.code);
            results.push(result);
            console.log('');
        }
        await context.close();
    }
    finally {
        await browser.close();
    }
    // Print summary
    console.log(`\n${'═'.repeat(60)}`);
    console.log('SUMMARY');
    console.log(`${'═'.repeat(60)}`);
    let verified = 0;
    let failed = 0;
    for (const r of results) {
        const status = r.verified ? '✓' : '✗';
        if (r.verified)
            verified++;
        else
            failed++;
        console.log(`${status} ${r.code}: ${r.actualName || r.expectedName}`);
        if (r.servicesFound.length > 0) {
            console.log(`  Services: ${r.servicesFound.length}`);
        }
        if (r.error) {
            console.log(`  Error: ${r.error}`);
        }
    }
    console.log(`\nTotal: ${verified} verified, ${failed} failed`);
}
main().catch(console.error);
