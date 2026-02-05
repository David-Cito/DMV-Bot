// Road Test Appointment Bot
// Monitors road test availability at Hawaii DMV

import { chromium, type Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { getSupabaseClient } from '../../packages/db/supabase_client';
import {
  upsertRoadTestSlots,
  markDisappearedSlots,
  recordRoadTestScan,
  type RoadTestSlotRecord,
} from '../../packages/db/road-test-slots';

// ============================================================================
// CONSTANTS
// ============================================================================

export const START_URL = 'https://www12.honolulu.gov/csdarts/frmApptInt.aspx';

// Road test locations from the site
export const LOCATIONS = ['Kapahulu', 'Kapolei', 'Koolau', 'Wahiawa', 'Waianae'];

const HST_TIME_ZONE = 'Pacific/Honolulu';
const INSTANT_ALERT_DAYS = 21; // Alert if appointment within 3 weeks

// File paths
const DATA_DIR = path.join(process.cwd(), 'data');
const SCREENSHOTS_DIR = path.join(DATA_DIR, 'screenshots');
const RESULTS_DIR = path.join(DATA_DIR, 'results');

// ============================================================================
// TYPES
// ============================================================================

export interface RoadTestSlot {
  time: string;           // e.g., "08:00 AM"
  location: string;       // e.g., "Kapahulu"
  type: 'regular' | 'standby';
  buttonName?: string;    // Form button name for booking
  buttonValue?: string;   // Form button value
}

export interface DayResult {
  date: string;           // YYYY-MM-DD
  dateDisplay: string;    // Human readable date
  slots: RoadTestSlot[];
}

export interface ScanResult {
  ok: boolean;
  reason?: string;
  scannedAt: string;
  currentDate?: string;
  days: DayResult[];
  summary: {
    totalSlots: number;
    byLocation: Record<string, number>;
    earliestDate: string | null;
    earliestDaysAway: number | null;
  };
  // Timing metrics
  durationMs?: number;
  daysScanned?: number;
  // Change tracking (populated after DB sync)
  changes?: {
    newSlots: number;
    reactivatedSlots: number;
    disappearedSlots: number;
  };
}

// ============================================================================
// DATE UTILITIES
// ============================================================================

function getHstToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: HST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function daysBetween(dateStr1: string, dateStr2: string): number {
  const d1 = new Date(`${dateStr1}T00:00:00Z`);
  const d2 = new Date(`${dateStr2}T00:00:00Z`);
  return Math.round((d2.getTime() - d1.getTime()) / (24 * 60 * 60 * 1000));
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function getMonthYear(dateStr: string): { month: number; year: number } {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return { month: d.getUTCMonth(), year: d.getUTCFullYear() };
}

function getDay(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDate();
}

// ============================================================================
// FILE I/O
// ============================================================================

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function saveScreenshot(page: Page, stepName: string): Promise<string> {
  ensureDir(SCREENSHOTS_DIR);
  const timestamp = Date.now();
  const filename = `road-test-${stepName}-${timestamp}.png`;
  const filepath = path.join(SCREENSHOTS_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: true });
  console.log(`[Screenshot] Saved: ${filename}`);
  return filepath;
}

function saveResults(result: ScanResult): void {
  ensureDir(RESULTS_DIR);
  const filepath = path.join(RESULTS_DIR, 'road-test-results.json');
  fs.writeFileSync(filepath, JSON.stringify(result, null, 2));
  console.log(`[Results] Saved to: ${filepath}`);
}

// ============================================================================
// BROWSER HELPERS
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Script to extract appointment data from the current page
const EXTRACT_APPOINTMENTS_SCRIPT = `
(() => {
  const result = {
    currentDate: null,
    slots: [],
  };

  // Try to get the current date from the calendar or page header
  const calendarTitle = document.querySelector('#Calendar1 .title, .CalendarTitle, [id*="Calendar"] td[colspan]');
  if (calendarTitle) {
    result.currentDate = calendarTitle.textContent?.trim() || null;
  }

  // Find the appointment table
  const tables = document.querySelectorAll('table');
  let appointmentTable = null;

  for (const table of tables) {
    const headers = table.querySelectorAll('th');
    const headerText = Array.from(headers).map(h => h.textContent?.trim() || '').join(' ');
    if (headerText.includes('Kapahulu') || headerText.includes('Kapolei') || headerText.includes('Time')) {
      appointmentTable = table;
      break;
    }
  }

  if (!appointmentTable) {
    return result;
  }

  // Get location names from header row
  const headerCells = appointmentTable.querySelectorAll('tr:first-child th');
  const locations = [];
  headerCells.forEach((th, index) => {
    if (index > 0) { // Skip "Time" column
      locations.push(th.textContent?.trim() || '');
    }
  });

  // Parse each data row
  const dataRows = appointmentTable.querySelectorAll('tr.TableItemLine, tr.TableAltItemLine');
  dataRows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length === 0) return;

    // First cell is time
    const timeCell = cells[0];
    const timeSpan = timeCell.querySelector('span');
    const time = timeSpan?.textContent?.trim() || '';

    // Check if this is the Stand-by row
    const isStandby = time.toLowerCase().includes('stand-by') ||
                      timeCell.querySelector('.TableFooter') !== null;

    // Process each location column
    for (let i = 1; i < cells.length && i <= locations.length; i++) {
      const cell = cells[i];
      const location = locations[i - 1];

      // Check for available slot (submit button)
      const button = cell.querySelector('input[type="submit"]');
      if (button) {
        result.slots.push({
          time: isStandby ? 'Stand-by' : time,
          location: location,
          type: isStandby ? 'standby' : 'regular',
          buttonName: button.getAttribute('name') || '',
          buttonValue: button.getAttribute('value') || '',
        });
      }
    }
  });

  return result;
})()
`;

// Script to get calendar info and find next month button
const GET_CALENDAR_INFO_SCRIPT = `
(() => {
  const result = {
    currentMonth: null,
    nextMonthButton: null,
    selectedDate: null,
  };

  // Find Calendar1 element
  const calendar = document.querySelector('#Calendar1, [id*="Calendar"]');
  if (!calendar) return result;

  // Get current month from calendar title
  const titleCell = calendar.querySelector('td[colspan], .title');
  if (titleCell) {
    result.currentMonth = titleCell.textContent?.trim() || null;
  }

  // Find the "next month" link - it's an <a> tag with title containing "next month"
  const nextLink = calendar.querySelector('a[title*="next month"]');
  if (nextLink) {
    result.nextMonthButton = {
      text: nextLink.textContent?.trim() || '',
      title: nextLink.getAttribute('title') || '',
      href: nextLink.getAttribute('href') || '',
    };
  }

  // Find selected/highlighted date
  const selectedCell = calendar.querySelector('td[style*="background"], td.selected, a[style*="background"]');
  if (selectedCell) {
    result.selectedDate = selectedCell.textContent?.trim() || null;
  }

  return result;
})()
`;

// ============================================================================
// MAIN SCRAPING LOGIC
// ============================================================================

export async function scanRoadTestAppointments(
  initialPage: Page,
  options: {
    scanDays?: number;
    takeScreenshots?: boolean;
  } = {}
): Promise<ScanResult> {
  const {
    scanDays = 45,
    takeScreenshots = true
  } = options;

  const scannedAt = new Date().toISOString();
  const hstToday = getHstToday();
  const startDate = addDays(hstToday, 1); // Start from tomorrow
  const endDate = addDays(hstToday, scanDays);
  const allDays: DayResult[] = [];
  const slotsByLocation: Record<string, number> = {};
  LOCATIONS.forEach(loc => slotsByLocation[loc] = 0);

  let page = initialPage; // Use let so we can switch to new tab if needed

  console.log(`[RoadTest] Starting scan...`);
  console.log(`[RoadTest] Today (HST): ${hstToday}`);
  console.log(`[RoadTest] Scan window: ${startDate} to ${endDate} (${scanDays} days)`);

  try {
    // Navigate to the appointment page
    // Session cookie should already be set by monitorRoadTest() warmup
    console.log(`[RoadTest] Navigating to: ${START_URL}`);
    await page.goto(START_URL, { timeout: 60000, waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#Calendar1', { timeout: 15000 });
    console.log(`[RoadTest] Navigation successful`);

    if (takeScreenshots) {
      await saveScreenshot(page, '01-initial');
    }

    // Check if we hit a CAPTCHA or error page
    const pageText = await page.evaluate(`document.body?.innerText?.slice(0, 500) || ''`) as string;
    if (pageText.toLowerCase().includes('captcha') || pageText.toLowerCase().includes('automated spam')) {
      console.log('[RoadTest] CAPTCHA detected - cannot proceed');
      return {
        ok: false,
        reason: 'CAPTCHA/bot detection encountered',
        scannedAt,
        days: [],
        summary: {
          totalSlots: 0,
          byLocation: slotsByLocation,
          earliestDate: null,
          earliestDaysAway: null,
        },
      };
    }

    // Track current calendar month/year
    let currentCalendarMonth = getMonthYear(hstToday);

    // Scan each day in the window
    let currentDate = startDate;
    let daysScanned = 0;

    while (currentDate <= endDate) {
      const targetMonthYear = getMonthYear(currentDate);
      const dayNum = getDay(currentDate);

      // Navigate to correct month if needed
      while (currentCalendarMonth.year < targetMonthYear.year ||
             (currentCalendarMonth.year === targetMonthYear.year && currentCalendarMonth.month < targetMonthYear.month)) {
        console.log(`[RoadTest] Advancing to next month...`);
        const nextButton = await page.$('a[title*="next month"]');
        if (!nextButton) {
          console.log('[RoadTest] Could not find next month button');
          break;
        }
        await nextButton.click();
        // Wait for calendar to update (faster than full load + sleep)
        await page.waitForSelector('#Calendar1', { timeout: 10000 });
        await sleep(200); // Minimal delay for ASP.NET postback
        currentCalendarMonth = {
          month: (currentCalendarMonth.month + 1) % 12,
          year: currentCalendarMonth.month === 11 ? currentCalendarMonth.year + 1 : currentCalendarMonth.year
        };
      }

      // Click on the day in the calendar
      // Calendar days are links with the day number as text
      const dayLink = await page.$(`#Calendar1 a:text-is("${dayNum}")`);

      if (dayLink) {
        // Click and wait for navigation to complete (ASP.NET postback)
        await Promise.all([
          page.waitForLoadState('domcontentloaded'),
          dayLink.click(),
        ]);
        // Small delay for ASP.NET to finish rendering
        await sleep(100);

        // Extract appointments for this day
        const extraction = await page.evaluate(EXTRACT_APPOINTMENTS_SCRIPT) as {
          currentDate: string | null;
          slots: RoadTestSlot[];
        };

        if (extraction.slots.length > 0) {
          const dayResult: DayResult = {
            date: currentDate,
            dateDisplay: currentDate,
            slots: extraction.slots,
          };

          allDays.push(dayResult);

          // Count slots by location
          extraction.slots.forEach(slot => {
            if (slotsByLocation[slot.location] !== undefined) {
              slotsByLocation[slot.location]++;
            }
          });
        }
      }

      daysScanned++;
      currentDate = addDays(currentDate, 1);
    }

    // Calculate summary
    const totalSlots = Object.values(slotsByLocation).reduce((a, b) => a + b, 0);
    console.log(`[RoadTest] Scanned ${daysScanned} days, found ${totalSlots} slots across ${allDays.length} days`);
    let earliestDate: string | null = null;
    let earliestDaysAway: number | null = null;

    // Find earliest date with slots
    if (allDays.length > 0) {
      const sortedDays = [...allDays].sort((a, b) => a.date.localeCompare(b.date));
      earliestDate = sortedDays[0].date;
      earliestDaysAway = daysBetween(hstToday, earliestDate);
    }

    const result: ScanResult = {
      ok: true,
      scannedAt,
      currentDate: hstToday,
      days: allDays,
      summary: {
        totalSlots,
        byLocation: slotsByLocation,
        earliestDate,
        earliestDaysAway,
      },
      daysScanned,
    };

    if (takeScreenshots) {
      await saveScreenshot(page, '02-final');
    }

    // Save results to file
    saveResults(result);

    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[RoadTest] Error: ${errorMessage}`);
    if (takeScreenshots) {
      try {
        await saveScreenshot(page, 'error');
      } catch {
        // Page may be closed, ignore screenshot error
      }
    }
    const result: ScanResult = {
      ok: false,
      reason: errorMessage,
      scannedAt,
      days: [],
      summary: {
        totalSlots: 0,
        byLocation: slotsByLocation,
        earliestDate: null,
        earliestDaysAway: null,
      },
    };
    saveResults(result);
    return result;
  }
}

// ============================================================================
// DISCOVERY MODE - For manual exploration
// ============================================================================

export async function runDiscovery(options: { headless?: boolean } = {}): Promise<void> {
  const { headless = false } = options;

  console.log('[Discovery] Starting road test site discovery...');
  console.log(`[Discovery] Target: ${START_URL}`);
  console.log(`[Discovery] Mode: ${headless ? 'headless' : 'headed (visible browser)'}`);

  const browser = await chromium.launch({
    headless,
    slowMo: headless ? 0 : 500
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
    timezoneId: 'Pacific/Honolulu',
  });
  const page = await context.newPage();

  try {
    await page.goto(START_URL, { waitUntil: 'load', timeout: 60000 });
    await saveScreenshot(page, '01-initial-load');

    const title = await page.title();
    console.log(`[Discovery] Page title: ${title}`);
    console.log(`[Discovery] Current URL: ${page.url()}`);

    // Get calendar info
    const calendarInfo = await page.evaluate(GET_CALENDAR_INFO_SCRIPT);
    console.log('[Discovery] Calendar info:', JSON.stringify(calendarInfo, null, 2));

    // Extract current appointments
    const extraction = await page.evaluate(EXTRACT_APPOINTMENTS_SCRIPT);
    console.log('[Discovery] Extraction result:', JSON.stringify(extraction, null, 2));

    // Save analysis
    const analysisPath = path.join(DATA_DIR, 'road-test-discovery.json');
    ensureDir(DATA_DIR);
    fs.writeFileSync(analysisPath, JSON.stringify({ calendarInfo, extraction }, null, 2));
    console.log(`[Discovery] Analysis saved to: ${analysisPath}`);

    if (!headless) {
      console.log('\n[Discovery] Browser will stay open for 60 seconds for manual inspection...');
      await sleep(60000);
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Discovery] Error: ${errorMessage}`);
    await saveScreenshot(page, 'error');
    throw error;
  } finally {
    await context.close();
    await browser.close();
    console.log('[Discovery] Browser closed.');
  }
}

// ============================================================================
// MAIN MONITORING FUNCTION
// ============================================================================

export async function monitorRoadTest(
  options: { headless?: boolean; slowMo?: number; scanDays?: number } = {}
): Promise<ScanResult> {
  const {
    headless = process.env.ROAD_TEST_HEADLESS !== 'false' && process.env.CI === 'true',
    slowMo = process.env.CI === 'true' ? 0 : 300,
    scanDays = 45,
  } = options;

  console.log(`[RoadTest] Starting monitoring...`);
  console.log(`[RoadTest] Mode: ${headless ? 'headless' : 'headed'}`);

  const browser = await chromium.launch({
    headless,
    slowMo,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
    timezoneId: 'Pacific/Honolulu',
  });

  // Warm up session cookie to avoid redirect chain
  // The site redirects www12 -> www8 -> www.honolulu.gov on first request (which hangs).
  // But if ASP.NET_SessionId cookie exists, it serves the page directly.
  // This request times out but successfully sets the session cookie.
  console.log(`[RoadTest] Warming up session...`);
  try {
    await context.request.get(START_URL, { timeout: 5000 });
  } catch {
    // Expected to timeout - the redirect chain hangs, but the cookie gets set
  }

  const page = await context.newPage();

  try {
    const result = await scanRoadTestAppointments(page, {
      scanDays,
      takeScreenshots: !headless,
    });
    return result;
  } finally {
    await context.close();
    await browser.close();
  }
}

// ============================================================================
// RESULT FORMATTING
// ============================================================================

export function formatResultMessage(result: ScanResult): string {
  const lines: string[] = [];
  const hstToday = getHstToday();

  if (!result.ok) {
    lines.push(`Road Test Scan Failed: ${result.reason || 'Unknown error'}`);
    return lines.join('\n');
  }

  if (result.summary.totalSlots === 0) {
    lines.push('No road test appointments currently available.');
    return lines.join('\n');
  }

  lines.push(`Road Test Appointments Found: ${result.summary.totalSlots} slots`);
  lines.push('');

  // Slots by location
  lines.push('By Location:');
  for (const [location, count] of Object.entries(result.summary.byLocation)) {
    if (count > 0) {
      lines.push(`  - ${location}: ${count} slot(s)`);
    }
  }

  // List all slots
  if (result.days.length > 0) {
    lines.push('');
    lines.push('Available Slots:');
    for (const day of result.days) {
      for (const slot of day.slots) {
        const typeLabel = slot.type === 'standby' ? ' [STANDBY]' : '';
        lines.push(`  - ${slot.time} at ${slot.location}${typeLabel}`);
      }
    }
  }

  // Alert check
  if (result.summary.earliestDaysAway !== null && result.summary.earliestDaysAway <= INSTANT_ALERT_DAYS) {
    lines.push('');
    lines.push(`** ALERT: Appointment available within ${INSTANT_ALERT_DAYS} days! **`);
  }

  return lines.join('\n');
}

// ============================================================================
// SUPABASE UPLOAD (with change tracking)
// ============================================================================

export async function uploadResultsToSupabase(result: ScanResult): Promise<{
  success: boolean;
  changes?: {
    newSlots: number;
    reactivatedSlots: number;
    disappearedSlots: number;
  };
}> {
  try {
    console.log('[Supabase] Uploading scan results with change tracking...');

    // Build slot records from scan result
    const slotRecords: RoadTestSlotRecord[] = [];
    for (const day of result.days) {
      for (const slot of day.slots) {
        slotRecords.push({
          date: day.date,
          time: slot.time,
          location: slot.location,
          slot_type: slot.type,
          button_name: slot.buttonName,
          button_value: slot.buttonValue,
        });
      }
    }

    // Upsert slots with change tracking
    const upsertResult = await upsertRoadTestSlots(slotRecords);
    console.log(`[Supabase] Slots: ${upsertResult.newSlots} new, ${upsertResult.reactivatedSlots} reactivated, ${upsertResult.updatedSlots} updated`);

    // Mark disappeared slots (not seen in this scan)
    // Use a cutoff of 5 minutes ago to account for scan duration
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    const disappearedCount = await markDisappearedSlots(cutoff);
    console.log(`[Supabase] Marked ${disappearedCount} slots as disappeared`);

    // Record the scan
    await recordRoadTestScan({
      ok: result.ok,
      reason: result.reason,
      durationMs: result.durationMs,
      daysScanned: result.daysScanned,
      totalSlots: result.summary.totalSlots,
      slotsByLocation: result.summary.byLocation,
      newSlotsCount: upsertResult.newSlots + upsertResult.reactivatedSlots,
      disappearedSlotsCount: disappearedCount,
    });

    console.log('[Supabase] Upload complete');

    return {
      success: true,
      changes: {
        newSlots: upsertResult.newSlots,
        reactivatedSlots: upsertResult.reactivatedSlots,
        disappearedSlots: disappearedCount,
      },
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Supabase] Upload failed: ${errorMessage}`);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    return { success: false };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  INSTANT_ALERT_DAYS,
  getHstToday,
  daysBetween,
};
