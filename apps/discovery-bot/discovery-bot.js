"use strict";
// Discovery Bot for DMV Appointment Supply Assessment
// Scans all locations and services to assess slot availability
// Used to determine which services have enough supply to justify queue/booking systems
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
exports.ALREADY_TRACKED_SERVICES = exports.ALL_LOCATIONS = exports.SATELLITE_LOCATIONS = exports.SATELLITE_OTHER_LOCATIONS = exports.SATELLITE_DL_LOCATIONS = exports.DRIVER_LICENSE_LOCATIONS = exports.START_URL = void 0;
exports.isServiceAlreadyTracked = isServiceAlreadyTracked;
exports.getUntrackedLocations = getUntrackedLocations;
exports.discoverServiceSupply = discoverServiceSupply;
exports.analyzeSupply = analyzeSupply;
exports.generateSupplyReport = generateSupplyReport;
exports.saveDiscoveryResults = saveDiscoveryResults;
exports.ensureDiscoveryDir = ensureDiscoveryDir;
const playwright_1 = require("playwright");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ============================================================================
// CONSTANTS
// ============================================================================
exports.START_URL = 'https://alohaq.honolulu.gov/';
// Driver License locations (green buttons on website)
exports.DRIVER_LICENSE_LOCATIONS = [
    {
        name: 'Commercial Drivers License (CDL)',
        code: 'CCDL',
        services: [
            { name: 'Commercial Driver License Services', transVal: '232' },
        ],
    },
    {
        name: 'Kapalama Driver License, State ID',
        code: 'KAPA',
        services: [
            { name: 'Hawaii License Duplicate', transVal: '236' },
            { name: 'Hawaii License Renewal', transVal: '186' },
            { name: 'Hawaii Provisional to a Full License', transVal: '187' },
            { name: 'Instruction Permit (Online Test Follow-up)', transVal: '288' },
            { name: 'Instruction Permit Duplicate', transVal: '188' },
            { name: 'Instruction Permit Initial (In-person Written Test)', transVal: '279' },
            { name: 'Instruction Permit Renewal', transVal: '190' },
            { name: 'Out Of State Transfer', transVal: '191' },
            { name: 'State ID Duplicate', transVal: '192' },
            { name: 'State ID Initial', transVal: '193' },
            { name: 'State ID Renewal', transVal: '194' },
        ],
    },
    {
        name: 'Kapolei Driver License, State ID',
        code: 'KAPO',
        services: [
            { name: 'Hawaii License Duplicate', transVal: '105' },
            { name: 'Hawaii License Renewal', transVal: '195' },
            { name: 'Hawaii Provisional to a Full License', transVal: '196' },
            { name: 'Instruction Permit (Online Test Follow-up)', transVal: '287' },
            { name: 'Instruction Permit Duplicate', transVal: '197' },
            { name: 'Instruction Permit Initial (In-person Written Test)', transVal: '280' },
            { name: 'Instruction Permit Renewal', transVal: '199' },
            { name: 'Out Of State Transfer', transVal: '200' },
            { name: 'State ID Duplicate', transVal: '201' },
            { name: 'State ID Initial', transVal: '202' },
            { name: 'State ID Renewal', transVal: '203' },
        ],
    },
    {
        name: 'Koolau Driver License, State ID',
        code: 'KOOL',
        services: [
            { name: 'Hawaii License Duplicate', transVal: '2' },
            { name: 'Hawaii License Renewal', transVal: '204' },
            { name: 'Hawaii Provisional to a Full License', transVal: '205' },
            { name: 'Instruction Permit (Online Test Follow-up)', transVal: '286' },
            { name: 'Instruction Permit Duplicate', transVal: '206' },
            { name: 'Instruction Permit Initial (In-person Written Test)', transVal: '281' },
            { name: 'Instruction Permit Renewal', transVal: '208' },
            { name: 'Out Of State Transfer', transVal: '209' },
            { name: 'State ID Duplicate', transVal: '210' },
            { name: 'State ID Initial', transVal: '211' },
            { name: 'State ID Renewal', transVal: '212' },
        ],
    },
    {
        name: 'Wahiawa Driver License, State ID',
        code: 'WADL',
        services: [
            { name: 'Hawaii License Duplicate', transVal: '106' },
            { name: 'Hawaii License Renewal', transVal: '214' },
            { name: 'Hawaii Provisional to a Full License', transVal: '215' },
            { name: 'Instruction Permit (Online Test Follow-up)', transVal: '285' },
            { name: 'Instruction Permit Duplicate', transVal: '216' },
            { name: 'Instruction Permit Initial (In-person Written Test)', transVal: '282' },
            { name: 'Instruction Permit Renewal', transVal: '218' },
            { name: 'Out Of State Transfer', transVal: '219' },
            { name: 'State ID Duplicate', transVal: '220' },
            { name: 'State ID Initial', transVal: '221' },
            { name: 'State ID Renewal', transVal: '222' },
        ],
    },
    {
        name: 'Waianae Driver License, State ID',
        code: 'WAIA',
        services: [
            { name: 'Hawaii License Duplicate', transVal: '107' },
            { name: 'Hawaii License Renewal', transVal: '223' },
            { name: 'Hawaii Provisional to a Full License', transVal: '224' },
            { name: 'Instruction Permit (Online Test Follow-up)', transVal: '284' },
            { name: 'Instruction Permit Duplicate', transVal: '225' },
            { name: 'Instruction Permit Initial (In-person Written Test)', transVal: '283' },
            { name: 'Instruction Permit Renewal', transVal: '227' },
            { name: 'Out Of State Transfer', transVal: '228' },
            { name: 'State ID Duplicate', transVal: '229' },
            { name: 'State ID Initial', transVal: '230' },
            { name: 'State ID Renewal', transVal: '231' },
        ],
    },
];
// Satellite City Halls for DL renewals/duplicates only (blue buttons)
exports.SATELLITE_DL_LOCATIONS = [
    {
        name: 'Downtown Satellite City Hall',
        code: 'FSCH',
        services: [
            { name: 'Motor Vehicles & Other Services', transVal: '157' },
            { name: 'DRIVER LICENSE & STATE ID Renewals', transVal: '256' },
            { name: 'Driver License or State ID Duplicates & Instruction Permit Renewals', transVal: '96' },
        ],
    },
    {
        name: 'Hawaii Kai Satellite City Hall',
        code: 'HKAI',
        services: [
            { name: 'Motor Vehicles & Other Services', transVal: '155' },
            { name: 'DRIVER LICENSE & STATE ID Renewals', transVal: '99' },
            { name: 'Driver License or State ID Duplicates & Instruction Permit Renewals', transVal: '255' },
        ],
    },
    {
        name: 'Pearlridge Satellite City Hall',
        code: 'PEAR',
        services: [
            { name: 'Motor Vehicles & Other Services', transVal: '84' },
            { name: 'DRIVER LICENSE & STATE ID Renewals', transVal: '257' },
            { name: 'Driver License or State ID Duplicates & Instruction Permit Renewals', transVal: '252' },
        ],
    },
    {
        name: 'Windward City Satellite City Hall',
        code: 'WIND',
        services: [
            { name: 'Motor Vehicles & Other Services', transVal: '113' },
            { name: 'DRIVER LICENSE & STATE ID Renewals', transVal: '98' },
            { name: 'Driver License or State ID Duplicates & Instruction Permit Renewals', transVal: '101' },
        ],
    },
];
// Other Satellite City Halls (dark blue buttons) - Motor Vehicles & other services
exports.SATELLITE_OTHER_LOCATIONS = [
    {
        name: 'Ala Moana Satellite City Hall',
        code: 'ALAM',
        services: [
            { name: 'Disability Parking Permits', transVal: '235' },
            { name: 'Motor Vehicles & Other Services', transVal: '146' },
            { name: 'U.S. Passport', transVal: '265' },
        ],
    },
    {
        name: 'Kapalama Satellite City Hall',
        code: 'KSCH',
        services: [
            { name: 'Motor Vehicles & Other Services', transVal: '66' },
        ],
    },
    {
        name: 'Kapolei Satellite City Hall',
        code: 'KAPS',
        services: [
            { name: 'Disability Parking Permit / Holo Card', transVal: '294' },
            { name: 'Motor Vehicles & Other Services', transVal: '176' },
            { name: 'U.S. Passport', transVal: '267' },
        ],
    },
    {
        name: 'Wahiawa Satellite City Hall',
        code: 'WAHI',
        services: [
            { name: 'Motor Vehicles & Other Services', transVal: '95' },
            { name: 'U.S. Passport', transVal: '268' },
        ],
    },
    {
        name: 'Waianae Satellite City Hall',
        code: 'WAIS',
        services: [
            { name: 'Motor Vehicles & Other Services', transVal: '275' },
        ],
    },
];
// Combined for convenience
exports.SATELLITE_LOCATIONS = [
    ...exports.SATELLITE_DL_LOCATIONS,
    ...exports.SATELLITE_OTHER_LOCATIONS,
];
// Combined list of all locations
exports.ALL_LOCATIONS = [
    ...exports.DRIVER_LICENSE_LOCATIONS,
    ...exports.SATELLITE_LOCATIONS,
];
// Services already tracked by monitoring bots - exclude from discovery
exports.ALREADY_TRACKED_SERVICES = [
    { locationCode: 'FSCH', servicePattern: 'Driver License & State ID Renewals' }, // Downtown
    { locationCode: 'HKAI', servicePattern: 'Driver License & State ID Renewals' }, // Hawaii Kai
    { locationCode: 'PEAR', servicePattern: 'Driver License & State ID Renewals' }, // Pearlridge
    { locationCode: 'WIND', servicePattern: 'Driver License & State ID Renewals' }, // Windward
];
// Helper to check if a service is already tracked
function isServiceAlreadyTracked(locationCode, serviceName) {
    return exports.ALREADY_TRACKED_SERVICES.some((tracked) => tracked.locationCode === locationCode &&
        serviceName.toLowerCase().includes(tracked.servicePattern.toLowerCase().slice(0, 20)));
}
// Get locations with untracked services filtered
function getUntrackedLocations() {
    return exports.ALL_LOCATIONS.map((loc) => ({
        ...loc,
        services: loc.services.filter((svc) => !isServiceAlreadyTracked(loc.code, svc.name)),
    })).filter((loc) => loc.services.length > 0);
}
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HST_TIME_ZONE = 'Pacific/Honolulu';
const SCAN_WINDOW_30_DAYS = 30;
const SCAN_WINDOW_60_DAYS = 60;
// File paths
const DATA_DIR = path.join(process.cwd(), 'data');
const DISCOVERY_DIR = path.join(DATA_DIR, 'discovery');
const RESULTS_PATH = path.join(DISCOVERY_DIR, 'discovery-results.json');
const HISTORY_DIR = path.join(DISCOVERY_DIR, 'history');
// ============================================================================
// DATE UTILITIES
// ============================================================================
function formatHstDate(date) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: HST_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}
function getHstToday() {
    return formatHstDate(new Date());
}
function addDays(dateStr, days) {
    const base = new Date(`${dateStr}T00:00:00Z`);
    if (Number.isNaN(base.getTime()))
        return dateStr;
    base.setUTCDate(base.getUTCDate() + days);
    return base.toISOString().slice(0, 10);
}
function isWeekendDate(dateStr) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    if (Number.isNaN(d.getTime()))
        return false;
    const day = d.getUTCDay();
    return day === 0 || day === 6;
}
function isWithinRange(dateStr, start, end) {
    if (!dateStr || !start || !end)
        return false;
    return dateStr >= start && dateStr <= end;
}
function monthKeyFromTitle(title) {
    const parts = (title || '').split(' ');
    if (parts.length < 2)
        return '';
    const monthName = parts[0];
    const year = parts[1];
    const shortIndex = MONTH_NAMES.findIndex((m) => m.toLowerCase() === monthName.toLowerCase());
    if (shortIndex >= 0 && year) {
        return `${year}-${String(shortIndex + 1).padStart(2, '0')}`;
    }
    const parsed = Date.parse(`${monthName} 1, ${year}`);
    if (Number.isNaN(parsed))
        return '';
    const date = new Date(parsed);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
// ============================================================================
// FILE I/O
// ============================================================================
function ensureDiscoveryDir() {
    if (!fs.existsSync(DISCOVERY_DIR)) {
        fs.mkdirSync(DISCOVERY_DIR, { recursive: true });
    }
    if (!fs.existsSync(HISTORY_DIR)) {
        fs.mkdirSync(HISTORY_DIR, { recursive: true });
    }
}
function saveDiscoveryResults(result) {
    ensureDiscoveryDir();
    fs.writeFileSync(RESULTS_PATH, JSON.stringify(result, null, 2), 'utf8');
    // Also save to history with timestamp
    const historyPath = path.join(HISTORY_DIR, `discovery-${result.runAt.replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(historyPath, JSON.stringify(result, null, 2), 'utf8');
}
// ============================================================================
// BROWSER HELPERS
// ============================================================================
async function enableRequestBlocking(page) {
    await page.route('**/*', (route) => {
        const req = route.request();
        const type = req.resourceType();
        const url = req.url();
        if (['image', 'media', 'font'].includes(type)) {
            return route.abort();
        }
        if (/google-analytics|googletagmanager|doubleclick|facebook|segment|hotjar/i.test(url)) {
            return route.abort();
        }
        return route.continue();
    });
}
async function readDatepickerMonthYear(page) {
    return page.$eval('#datepicker .ui-datepicker-title', (el) => {
        const month = el.querySelector('.ui-datepicker-month')?.textContent?.trim() || '';
        const year = el.querySelector('.ui-datepicker-year')?.textContent?.trim() || '';
        return `${month} ${year}`.trim();
    });
}
async function advanceToNextMonth(page) {
    const before = await readDatepickerMonthYear(page);
    const nextButton = page.locator('#datepicker .ui-datepicker-next');
    await nextButton.waitFor({ state: 'visible', timeout: 15_000 });
    await nextButton.click();
    await page.waitForFunction(`(() => {
      const title = document.querySelector('#datepicker .ui-datepicker-title');
      if (!title) return false;
      const month = title.querySelector('.ui-datepicker-month')?.textContent?.trim() || '';
      const year = title.querySelector('.ui-datepicker-year')?.textContent?.trim() || '';
      const current = (month + ' ' + year).trim();
      return current && current !== "${before}";
    })()`);
}
/**
 * Navigate from START_URL to the service list for a given location.
 * Returns navigation result with verification info.
 */
async function navigateToLocationServiceList(page, locationCode, locationName) {
    // Navigate to start
    await page.goto(exports.START_URL, { waitUntil: 'domcontentloaded' });
    // Click Driver Licensing
    const driverLicensingLink = page.getByText('Driver Licensing and');
    await driverLicensingLink.waitFor({ state: 'visible', timeout: 30_000 });
    await driverLicensingLink.click();
    const makeApptButton = page.locator('#newAppointment');
    const makeApptText = page.locator('#newAppointment >> text=Make Appointment');
    const header = page.getByText('Select location to schedule ticket at');
    const gear = page.locator('.fa-cog, .fa-gear').first();
    // Wait for page to load after clicking Driver Licensing
    await page.locator('#start').waitFor({ state: 'visible', timeout: 120_000 });
    // Get to location selection - click Make Appointment if header not visible
    if (!(await header.isVisible().catch(() => false))) {
        await makeApptButton.waitFor({ state: 'visible', timeout: 120_000 });
        try {
            await makeApptButton.click({ timeout: 15_000 });
        }
        catch {
            await makeApptText.scrollIntoViewIfNeeded().catch(() => { });
            await makeApptText.click({ timeout: 15_000, force: true });
        }
    }
    // Wait for location selection header
    if (!(await header.isVisible().catch(() => false))) {
        const headerSeen = await header.waitFor({ timeout: 45_000 }).catch(() => null);
        if (!headerSeen) {
            // Try clicking Make Appointment again
            await makeApptButton.click({ timeout: 15_000 }).catch(async () => {
                await makeApptText.scrollIntoViewIfNeeded().catch(() => { });
                await makeApptText.click({ timeout: 15_000, force: true });
            });
        }
        await header.waitFor({ timeout: 120_000 });
    }
    // Wait for location tiles to appear
    await gear.waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => { });
    await page.waitForSelector('.location.button-look.next[data-loc-val]', { timeout: 30_000 });
    const locationTile = page.locator(`.location.button-look.next[data-loc-val="${locationCode}"]`);
    const locationVisible = await locationTile.isVisible().catch(() => false);
    if (!locationVisible) {
        const availableCodes = await page.$$eval('.location.button-look.next[data-loc-val]', (els) => els.map((el) => el.getAttribute('data-loc-val')));
        return {
            ok: false,
            error: `Location code ${locationCode} not found. Available: ${availableCodes.join(', ')}`,
            verifiedLocation: false,
        };
    }
    // Verify location BEFORE clicking using data-loc-nam-val attribute
    let verifiedLocation = false;
    let verificationMethod = '';
    let actualLocationName = '';
    const locNameVal = await locationTile.getAttribute('data-loc-nam-val');
    const locVal = await locationTile.getAttribute('data-loc-val');
    if (locVal === locationCode) {
        verifiedLocation = true;
        verificationMethod = 'data-loc-val_match';
        actualLocationName = locNameVal || '';
    }
    if (locNameVal && locNameVal.toLowerCase().includes(locationName.split(' ')[0].toLowerCase())) {
        verifiedLocation = true;
        verificationMethod = 'data-loc-nam-val_match';
        actualLocationName = locNameVal;
    }
    console.log(`  [Verify] ${locationCode}: ${verifiedLocation ? '✓' : '?'} ${actualLocationName || 'unknown'}`);
    await locationTile.click({ timeout: 10_000 });
    // Wait for #transaction container to load (services)
    await page.waitForSelector('#transaction', { state: 'visible', timeout: 30_000 });
    await page.waitForSelector('.transaction.button-look[data-trans-val]', { state: 'visible', timeout: 30_000 });
    await gear.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => { });
    return {
        ok: true,
        verifiedLocation,
        verificationMethod,
        actualLocationName,
    };
}
/**
 * Navigate back to the service list for the current location.
 * Called after scanning a service's datepicker.
 */
async function returnToServiceList(page) {
    const gear = page.locator('.fa-cog, .fa-gear').first();
    const backButton = page.locator('.button-look.back');
    try {
        // Click the Back button to return to service list
        await backButton.waitFor({ state: 'visible', timeout: 5_000 });
        await backButton.click();
        // Check if we landed on acknowledgment page and need to go back again
        const ackCheckbox = page.getByText('I have ALL the Required');
        if (await ackCheckbox.isVisible({ timeout: 1_000 }).catch(() => false)) {
            await backButton.waitFor({ state: 'visible', timeout: 5_000 });
            await backButton.click();
        }
        // Wait for service list to be visible
        await page.waitForSelector('.transaction.button-look[data-trans-val]', { state: 'visible', timeout: 15_000 });
        await gear.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => { });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Scan a single service from the service list (assumes we're already on the service list page).
 * After scanning, returns to the service list for the next service.
 */
async function scanServiceFromList(page, serviceName, serviceTransVal, locationCode, locationName, navResult) {
    const scannedAt = new Date().toISOString();
    const gear = page.locator('.fa-cog, .fa-gear').first();
    const { verifiedLocation, verificationMethod } = navResult;
    try {
        // Find service by data-trans-val
        const serviceLocator = page.locator(`.transaction.button-look[data-trans-val="${serviceTransVal}"]`);
        const serviceVisible = await serviceLocator.isVisible().catch(() => false);
        if (!serviceVisible) {
            const availableServices = await page.$$eval('.transaction.button-look[data-trans-val]', (els) => els.map((el) => `[${el.getAttribute('data-trans-val')}] ${el.getAttribute('data-trans-name')}`));
            return {
                locationName,
                locationCode,
                serviceName,
                ok: false,
                error: `Service transVal=${serviceTransVal} not found. Available: ${availableServices.join(' | ')}`,
                slots30Day: 0,
                slots60Day: 0,
                totalSlots: 0,
                daysWithSlots: 0,
                soonestDate: null,
                soonestSlotCount: 0,
                verifiedLocation,
                verificationMethod,
                scannedAt,
            };
        }
        // Check if service is disabled
        const isDisabled = await serviceLocator.evaluate((el) => el.classList.contains('btn-disabled'));
        if (isDisabled) {
            return {
                locationName,
                locationCode,
                serviceName,
                ok: false,
                error: `Service is disabled (btn-disabled)`,
                slots30Day: 0,
                slots60Day: 0,
                totalSlots: 0,
                daysWithSlots: 0,
                soonestDate: null,
                soonestSlotCount: 0,
                verifiedLocation,
                verificationMethod,
                scannedAt,
            };
        }
        await serviceLocator.click();
        await page.waitForLoadState('domcontentloaded');
        // Check for acknowledgment checkbox
        const requiredAck = page.getByText('I have ALL the Required');
        const hasAck = await requiredAck.isVisible({ timeout: 5_000 }).catch(() => false);
        if (hasAck) {
            await requiredAck.click();
            await page.waitForLoadState('domcontentloaded');
        }
        // Wait for datepicker
        const datepicker = page.locator('#datepicker');
        await datepicker.waitFor({ state: 'visible', timeout: 60_000 });
        // Check if there are ANY selectable days
        const hasSelectableDays = await page.$$eval('#datepicker td[data-handler="selectDay"]', (els) => els.length > 0);
        if (!hasSelectableDays) {
            return {
                locationName,
                locationCode,
                serviceName,
                ok: true,
                slots30Day: 0,
                slots60Day: 0,
                totalSlots: 0,
                daysWithSlots: 0,
                soonestDate: null,
                soonestSlotCount: 0,
                verifiedLocation,
                verificationMethod,
                scannedAt,
            };
        }
        // Scan for slots in both 30-day and 60-day windows
        const hstToday = getHstToday();
        const windowStart = addDays(hstToday, 1);
        const window30End = addDays(hstToday, SCAN_WINDOW_30_DAYS);
        const window60End = addDays(hstToday, SCAN_WINDOW_60_DAYS);
        const endMonthKey = window60End.slice(0, 7);
        let slots30Day = 0;
        let slots60Day = 0;
        let daysWithSlots = 0;
        let soonestDate = null;
        let soonestSlotCount = 0;
        while (true) {
            const monthTitle = await readDatepickerMonthYear(page);
            const monthKey = monthKeyFromTitle(monthTitle);
            const dayCells = await page.$$eval('#datepicker td[data-handler="selectDay"]', (els) => els.map((el) => {
                const link = el.querySelector('a.ui-state-default');
                if (!link)
                    return null;
                const day = (link.textContent || '').trim();
                const month = el.getAttribute('data-month');
                const year = el.getAttribute('data-year');
                return day ? { day, month, year } : null;
            }).filter(Boolean));
            for (const d of dayCells) {
                if (!d)
                    continue;
                const dateStr = `${d.year}-${String(Number(d.month) + 1).padStart(2, '0')}-${d.day.padStart(2, '0')}`;
                if (!isWithinRange(dateStr, windowStart, window60End))
                    continue;
                if (isWeekendDate(dateStr))
                    continue;
                const dayLocator = page
                    .locator(`#datepicker td[data-handler="selectDay"][data-month="${d.month}"][data-year="${d.year}"] a.ui-state-default`)
                    .filter({ hasText: new RegExp(`^${d.day}$`) })
                    .first();
                if (!(await dayLocator.count()))
                    continue;
                await dayLocator.click();
                await page.waitForFunction(`(() => {
            const wrap = document.querySelector('.time_wrap');
            if (!wrap) return false;
            const slotsInner = wrap.querySelectorAll('.time[data-val]');
            return slotsInner.length > 0;
          })()`, { timeout: 30_000 }).catch(() => { });
                await gear.waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => { });
                const daySlots = await page.$$eval('.time_wrap .time[data-val]', (els) => els.length);
                if (daySlots > 0) {
                    if (dateStr <= window30End) {
                        slots30Day += daySlots;
                    }
                    else {
                        slots60Day += daySlots;
                    }
                    daysWithSlots += 1;
                    if (!soonestDate) {
                        soonestDate = dateStr;
                        soonestSlotCount = daySlots;
                    }
                }
            }
            if (!monthKey || monthKey >= endMonthKey)
                break;
            await advanceToNextMonth(page);
        }
        const totalSlots = slots30Day + slots60Day;
        return {
            locationName,
            locationCode,
            serviceName,
            ok: true,
            slots30Day,
            slots60Day,
            totalSlots,
            daysWithSlots,
            soonestDate,
            soonestSlotCount,
            verifiedLocation,
            verificationMethod,
            scannedAt,
        };
    }
    catch (error) {
        return {
            locationName,
            locationCode,
            serviceName,
            ok: false,
            error: error?.message || String(error),
            slots30Day: 0,
            slots60Day: 0,
            totalSlots: 0,
            daysWithSlots: 0,
            soonestDate: null,
            soonestSlotCount: 0,
            verifiedLocation: false,
            scannedAt,
        };
    }
}
// ============================================================================
// MAIN DISCOVERY FUNCTION
// ============================================================================
async function discoverServiceSupply(locationConfig, options = {}) {
    const { headless = process.env.CI === 'true', slowMo = parseInt(process.env.DISCOVERY_SLOW_MO || '0', 10), timeoutMs = 180_000 // 3 minute timeout per location
     } = options;
    let browser = null;
    let context = null;
    const services = [];
    try {
        browser = await playwright_1.chromium.launch({ headless, slowMo });
        context = await browser.newContext();
        const page = await context.newPage();
        await enableRequestBlocking(page);
        // Navigate to location's service list once
        console.log(`[Discovery] Navigating to ${locationConfig.name} (${locationConfig.code})`);
        const navResult = await navigateToLocationServiceList(page, locationConfig.code, locationConfig.name);
        if (!navResult.ok) {
            // Location navigation failed - mark all services as failed
            console.log(`  -> Navigation error: ${navResult.error}`);
            for (const service of locationConfig.services) {
                services.push({
                    locationName: locationConfig.name,
                    locationCode: locationConfig.code,
                    serviceName: service.name,
                    ok: false,
                    error: navResult.error || 'Navigation to location failed',
                    slots30Day: 0,
                    slots60Day: 0,
                    totalSlots: 0,
                    daysWithSlots: 0,
                    soonestDate: null,
                    soonestSlotCount: 0,
                    verifiedLocation: false,
                    scannedAt: new Date().toISOString(),
                });
            }
        }
        else {
            // Loop through services, scanning each from the service list
            for (let i = 0; i < locationConfig.services.length; i++) {
                const service = locationConfig.services[i];
                console.log(`[Discovery] Scanning ${locationConfig.name} (${locationConfig.code}) - ${service.name} [${service.transVal}]`);
                try {
                    // Scan service with timeout
                    const servicePromise = scanServiceFromList(page, service.name, service.transVal, locationConfig.code, locationConfig.name, navResult);
                    const timeoutPromise = new Promise((_, reject) => {
                        setTimeout(() => reject(new Error('Service scan timeout')), timeoutMs);
                    });
                    const result = await Promise.race([servicePromise, timeoutPromise]);
                    services.push(result);
                    if (result.ok) {
                        const verifyStatus = result.verifiedLocation ? '✓' : '?';
                        console.log(`  -> [${verifyStatus}] 30d: ${result.slots30Day} | 60d: ${result.slots60Day} | soonest: ${result.soonestDate || 'NONE'}`);
                    }
                    else {
                        console.log(`  -> Error: ${result.error}`);
                    }
                    // Return to service list for next service (unless this is the last one)
                    if (i < locationConfig.services.length - 1) {
                        const returnedOk = await returnToServiceList(page);
                        if (!returnedOk) {
                            // Re-navigate to location if we couldn't return to service list
                            console.log(`  [Recovery] Re-navigating to location service list`);
                            await navigateToLocationServiceList(page, locationConfig.code, locationConfig.name);
                        }
                    }
                }
                catch (serviceError) {
                    // Handle per-service errors without stopping the whole location
                    console.log(`  -> Error: ${serviceError?.message || String(serviceError)}`);
                    services.push({
                        locationName: locationConfig.name,
                        locationCode: locationConfig.code,
                        serviceName: service.name,
                        ok: false,
                        error: serviceError?.message || String(serviceError),
                        slots30Day: 0,
                        slots60Day: 0,
                        totalSlots: 0,
                        daysWithSlots: 0,
                        soonestDate: null,
                        soonestSlotCount: 0,
                        verifiedLocation: false,
                        scannedAt: new Date().toISOString(),
                    });
                    // Try to recover for next service
                    if (i < locationConfig.services.length - 1) {
                        try {
                            console.log(`  [Recovery] Re-navigating to location service list`);
                            await navigateToLocationServiceList(page, locationConfig.code, locationConfig.name);
                        }
                        catch {
                            // Continue anyway, will fail on next service if unrecoverable
                        }
                    }
                }
            }
        }
    }
    catch (error) {
        console.log(`[Discovery] Browser error for ${locationConfig.name}: ${error?.message}`);
        // Mark remaining services as failed
        for (const service of locationConfig.services) {
            if (!services.find(s => s.serviceName === service.name)) {
                services.push({
                    locationName: locationConfig.name,
                    locationCode: locationConfig.code,
                    serviceName: service.name,
                    ok: false,
                    error: `Browser error: ${error?.message}`,
                    slots30Day: 0,
                    slots60Day: 0,
                    totalSlots: 0,
                    daysWithSlots: 0,
                    soonestDate: null,
                    soonestSlotCount: 0,
                    verifiedLocation: false,
                    scannedAt: new Date().toISOString(),
                });
            }
        }
    }
    finally {
        // Ensure cleanup happens
        try {
            if (context)
                await context.close().catch(() => { });
            if (browser)
                await browser.close().catch(() => { });
        }
        catch {
            // Ignore cleanup errors
        }
    }
    return {
        locationName: locationConfig.name,
        services,
        scannedAt: new Date().toISOString(),
    };
}
// ============================================================================
// SUPPLY ANALYSIS
// ============================================================================
function analyzeSupply(results) {
    // Group by service name across all locations
    const serviceMap = new Map();
    for (const location of results.locations) {
        for (const service of location.services) {
            const key = normalizeServiceName(service.serviceName);
            if (!serviceMap.has(key)) {
                serviceMap.set(key, []);
            }
            serviceMap.get(key).push(service);
        }
    }
    const summaries = [];
    for (const [serviceName, serviceResults] of serviceMap) {
        const successfulScans = serviceResults.filter(r => r.ok);
        const withSupply = successfulScans.filter(r => r.totalSlots > 0);
        const withNoSupply = successfulScans.filter(r => r.totalSlots === 0);
        const slots30Day = successfulScans.reduce((sum, r) => sum + r.slots30Day, 0);
        const slots60Day = successfulScans.reduce((sum, r) => sum + r.slots60Day, 0);
        const totalSlots = slots30Day + slots60Day;
        // Find soonest date across all locations
        let soonestDate = null;
        for (const r of withSupply) {
            if (r.soonestDate && (!soonestDate || r.soonestDate < soonestDate)) {
                soonestDate = r.soonestDate;
            }
        }
        // Determine recommendation based on SCARCITY (no availability = high demand)
        // Focus on 30-day window - if no slots in 30 days, that's high demand
        let recommendation;
        const noSlots30Day = successfulScans.filter(r => r.slots30Day === 0).length;
        const scarcityRatio30 = successfulScans.length > 0
            ? noSlots30Day / successfulScans.length
            : 0;
        if (successfulScans.length === 0) {
            // Couldn't scan this service
            recommendation = 'none';
        }
        else if (scarcityRatio30 >= 0.8 || (noSlots30Day >= 2 && slots30Day < 10)) {
            // 80%+ locations have no availability in 30 days, or very few slots
            // HIGH DEMAND - worth monitoring frequently
            recommendation = 'high';
        }
        else if (scarcityRatio30 >= 0.5 || slots30Day < 30) {
            // 50%+ locations have no availability in 30 days, or low supply
            // MEDIUM DEMAND - worth monitoring
            recommendation = 'medium';
        }
        else if (slots30Day < 100) {
            // Some scarcity but reasonable supply
            recommendation = 'low';
        }
        else {
            // Plenty of availability - users don't need our help
            recommendation = 'none';
        }
        summaries.push({
            serviceName,
            totalLocations: serviceResults.length,
            locationsWithSupply: withSupply.length,
            locationsWithNoSupply: withNoSupply.length,
            slots30Day,
            slots60Day,
            totalSlots,
            avgSlotsPerLocation: withSupply.length > 0 ? Math.round(totalSlots / withSupply.length) : 0,
            soonestDate,
            recommendation,
        });
    }
    // Sort by scarcity (lowest slots first = highest demand)
    return summaries.sort((a, b) => a.totalSlots - b.totalSlots);
}
function normalizeServiceName(name) {
    // Normalize similar service names
    return name
        .replace(/\s*\(.*?\)\s*/g, '') // Remove parentheticals
        .replace(/\s+/g, ' ')
        .trim();
}
// ============================================================================
// REPORT GENERATION
// ============================================================================
function getSupplyIndicator(service) {
    if (!service.ok)
        return 'ERR';
    if (service.slots30Day === 0 && service.slots60Day === 0)
        return 'SCARCE';
    if (service.slots30Day === 0)
        return 'LIMITED';
    if (service.slots30Day < 10)
        return 'LOW';
    return 'OK';
}
function generateLocationSection(location) {
    const services = location.services;
    const locationCode = services[0]?.locationCode || '';
    const successful = services.filter(s => s.ok);
    const available = successful.filter(s => s.totalSlots > 0);
    const noSlots = successful.filter(s => s.totalSlots === 0);
    let section = `## ${location.locationName} (${locationCode})\n\n`;
    section += '| Service | 30-Day | 31-60d | Soonest | Status |\n';
    section += '|---------|--------|--------|---------|--------|\n';
    for (const service of services) {
        const status = getSupplyIndicator(service);
        const soonest = service.soonestDate || 'NONE';
        // Truncate long service names
        const shortName = service.serviceName.length > 45
            ? service.serviceName.slice(0, 42) + '...'
            : service.serviceName;
        section += `| ${shortName} | ${service.slots30Day} | ${service.slots60Day} | ${soonest} | ${status} |\n`;
    }
    section += '\n';
    // Summary line
    if (noSlots.length > 0) {
        const noSlotNames = noSlots.map(s => s.serviceName.split(' ')[0]).join(', ');
        section += `**Summary:** ${available.length}/${successful.length} services available. No slots: ${noSlotNames}\n`;
    }
    else {
        section += `**Summary:** ${available.length}/${successful.length} services available.\n`;
    }
    section += '\n---\n\n';
    return section;
}
function generateSupplyReport(results) {
    const successRate = results.totalServices > 0
        ? Math.round(results.successfulScans / results.totalServices * 100)
        : 0;
    // Header
    let report = '# DMV Service Supply Discovery Report\n\n';
    report += `Generated: ${results.completedAt}\n`;
    report += `Duration: ${Math.round(results.durationMs / 1000)}s | `;
    report += `Locations: ${results.totalLocations} | `;
    report += `Services: ${results.totalServices} | `;
    report += `Success: ${successRate}%\n\n`;
    // Location sections
    for (const location of results.locations) {
        report += generateLocationSection(location);
    }
    // Service overview across all locations
    const summaries = analyzeSupply(results);
    report += '## Service Overview (All Locations)\n\n';
    report += '| Service | Locations w/ Supply | Total 30d | Demand |\n';
    report += '|---------|---------------------|-----------|--------|\n';
    for (const summary of summaries) {
        const demandLabel = {
            high: 'HIGH',
            medium: 'MED',
            low: 'LOW',
            none: 'OK',
        }[summary.recommendation];
        const locSupply = `${summary.locationsWithSupply}/${summary.totalLocations}`;
        const shortName = summary.serviceName.length > 35
            ? summary.serviceName.slice(0, 32) + '...'
            : summary.serviceName;
        report += `| ${shortName} | ${locSupply} | ${summary.slots30Day} | ${demandLabel} |\n`;
    }
    report += '\n## Recommendations\n\n';
    const highDemand = summaries.filter(s => s.recommendation === 'high');
    const mediumDemand = summaries.filter(s => s.recommendation === 'medium');
    const available = summaries.filter(s => s.recommendation === 'none');
    if (highDemand.length > 0) {
        report += '### HIGH Demand - Start Frequent Monitoring\n';
        report += 'These services have NO or very few appointments available. Users need our queue/booking system.\n\n';
        for (const s of highDemand) {
            report += `- **${s.serviceName}**: ${s.locationsWithNoSupply}/${s.totalLocations} locations have NO availability`;
            if (s.totalSlots > 0) {
                report += ` (only ${s.totalSlots} total slots found)`;
            }
            report += '\n';
        }
        report += '\n';
    }
    if (mediumDemand.length > 0) {
        report += '### MEDIUM Demand - Monitor Weekly\n';
        report += 'Limited availability. Worth tracking to see if demand increases.\n\n';
        for (const s of mediumDemand) {
            report += `- **${s.serviceName}**: ${s.totalSlots} slots across ${s.locationsWithSupply} locations\n`;
        }
        report += '\n';
    }
    if (available.length > 0) {
        report += '### LOW Priority - Available\n';
        report += 'Plenty of appointments available. Users can self-serve.\n\n';
        for (const s of available) {
            report += `- **${s.serviceName}**: ${s.totalSlots} slots available\n`;
        }
        report += '\n';
    }
    report += '## Next Steps\n\n';
    report += 'For HIGH DEMAND services:\n';
    report += '1. Run discovery scans every 2-4 hours for 1 week\n';
    report += '2. Track how often new appointments appear (churn rate)\n';
    report += '3. If appointments appear regularly, enable queue/booking system\n';
    report += '4. If appointments rarely appear, service may not be viable\n';
    return report;
}
