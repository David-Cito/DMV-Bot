// Monitoring Bot for DMV Appointment Availability
// Monitors 4 Hawaii DMV locations and captures slot data

import { chromium, type Browser, type Page, type BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// CONSTANTS
// ============================================================================

export const START_URL = 'https://alohaq.honolulu.gov/';

export const LOCATIONS = [
  'Downtown Satellite City Hall',
  'Hawaii Kai Satellite City Hall',
  'Pearlridge Satellite City Hall',
  'Windward City Satellite City Hall',
];

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HST_TIME_ZONE = 'Pacific/Honolulu';
const SCAN_WINDOW_DAYS = 30;

// Environment configuration
const TARGET_DATE_ENV = process.env.DMV_TARGET_DATE || '';
const TARGET_WINDOW_ENV = process.env.DMV_TARGET_WINDOW_DAYS || '';
const LOG_BOOKING_URL = (process.env.DMV_LOG_BOOKING_URL || '').toLowerCase() === 'true';

// File paths
const DATA_DIR = path.join(process.cwd(), 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const HISTORY_PATH = path.join(HISTORY_DIR, 'dmv-history.json');
const MONTH_HISTORY_BASENAME = 'dmv-month-history';
const RESULTS_DIR = path.join(DATA_DIR, 'results');
const RUN_BUFFER_PATH = path.join(RESULTS_DIR, 'dmv-run-buffer.json');
const RUN_LOCK_PATH = path.join(RESULTS_DIR, '.dmv-run.lock');

// ============================================================================
// TYPES
// ============================================================================

export interface Slot {
  dataVal: string;
  text: string;
}

export interface DaySlots {
  date: string;
  slots: Slot[];
}

export interface MonthSummary {
  monthLabel: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  totalAppts: number;
}

export interface LocationResult {
  locationName: string;
  ok: boolean;
  reason?: string;
  dateText?: string;
  timeText?: string;
  dataVal?: string;
  daySlots?: Slot[];
  monthSlots?: DaySlots[];
}

interface HistoryChange {
  changedAt: string;
  fromDataVal: string;
  fromDateText?: string;
  fromTimeText?: string;
  toDataVal: string;
  toDateText?: string;
  toTimeText?: string;
  deltaMs: number | null;
  direction: string;
  deltaDays: number | null;
}

interface LocationEntry {
  lastDataVal?: string;
  lastDateText?: string;
  lastTimeText?: string;
  lastSeenAt?: string;
  changes: HistoryChange[];
}

interface OverallEntry {
  lastDataVal?: string;
  lastLocation?: string;
  lastSeenAt?: string;
  changes: HistoryChange[];
}

interface History {
  locations: Record<string, LocationEntry>;
  overall: OverallEntry;
  lastRunAt?: string;
}

interface RunBuffer {
  runAt: string;
  results: LocationResult[];
}

interface ScanResult {
  monthSlots: DaySlots[];
  totalAppointments: number;
  eligibleDays: number;
  totalSelectableDays: number;
}

interface EarliestSlot {
  dateStr: string;
  dataVal: string;
  timeText: string;
  daySlots: Slot[];
}

// ============================================================================
// DATE UTILITIES
// ============================================================================

function ordinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function formatHumanDate(dateStr: string): string {
  if (!dateStr) return 'Unknown date';
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  const day = d.getUTCDate();
  const weekday = WEEKDAY_NAMES[d.getUTCDay()];
  const month = MONTH_NAMES[d.getUTCMonth()];
  return `${weekday}, ${month} ${day}${ordinalSuffix(day)}`;
}

function formatHumanMonth(dateStr: string): string {
  if (!dateStr) return 'Unknown month';
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr.slice(0, 7) || dateStr;
  const month = MONTH_NAMES[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  return `${month} ${year}`;
}

function toTime(dateStr: string): number {
  return Date.parse(dateStr);
}

function todayPlus(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatHstDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: HST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getHstToday(): string {
  return formatHstDate(new Date());
}

function addDays(dateStr: string, days: number): string {
  const base = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return dateStr;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function isWeekendDate(dateStr: string): boolean {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

function isWithinRange(dateStr: string, start: string, end: string): boolean {
  if (!dateStr || !start || !end) return false;
  return dateStr >= start && dateStr <= end;
}

function monthKeyFromTitle(title: string): string {
  const parts = (title || '').split(' ');
  if (parts.length < 2) return '';
  const monthName = parts[0];
  const year = parts[1];
  const shortIndex = MONTH_NAMES.findIndex(
    (m) => m.toLowerCase() === monthName.toLowerCase()
  );
  if (shortIndex >= 0 && year) {
    return `${year}-${String(shortIndex + 1).padStart(2, '0')}`;
  }
  const parsed = Date.parse(`${monthName} 1, ${year}`);
  if (Number.isNaN(parsed)) return '';
  const date = new Date(parsed);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ============================================================================
// SLOT UTILITIES
// ============================================================================

function extractTimePart(slot: Slot): string {
  const dataVal = slot?.dataVal || '';
  return dataVal.split(' ')[1] || '';
}

function buildTimeList(slots: Slot[]): string[] {
  if (!Array.isArray(slots)) return [];
  return [...slots]
    .map((s) => extractTimePart(s))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function buildMonthByDate(monthSlots: DaySlots[]): Record<string, string[]> {
  if (!Array.isArray(monthSlots)) return {};
  const byDate: Record<string, string[]> = {};
  for (const day of monthSlots) {
    if (!day || !day.date) continue;
    byDate[day.date] = buildTimeList(day.slots);
  }
  return byDate;
}

function splitMonthSlotsByMonth(monthSlots: DaySlots[]): Record<string, DaySlots[]> {
  const grouped: Record<string, DaySlots[]> = {};
  for (const day of monthSlots || []) {
    if (!day || !day.date) continue;
    const key = day.date.slice(0, 7);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(day);
  }
  return grouped;
}

export function summarizeMonthSlots(monthSlots: DaySlots[]): MonthSummary | null {
  if (!Array.isArray(monthSlots) || !monthSlots.length) return null;
  const validDays = monthSlots
    .filter((d) => d && d.date)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (!validDays.length) return null;
  const start = validDays[0].date;
  const end = validDays[validDays.length - 1].date;
  const totalDays = validDays.length;
  const totalAppts = validDays.reduce((acc, d) => acc + ((d.slots && d.slots.length) || 0), 0);
  return {
    monthLabel: formatHumanMonth(start),
    startDate: formatHumanDate(start),
    endDate: formatHumanDate(end),
    totalDays,
    totalAppts,
  };
}

function countMonthAppointments(monthSlots: DaySlots[]): number {
  if (!Array.isArray(monthSlots)) return 0;
  return monthSlots.reduce((sum, day) => sum + ((day && day.slots && day.slots.length) || 0), 0);
}

function findEarliestSlot(monthSlots: DaySlots[]): EarliestSlot | null {
  let earliest: EarliestSlot | null = null;
  for (const day of monthSlots || []) {
    if (!day || !day.date || !Array.isArray(day.slots) || !day.slots.length) continue;
    const sorted = [...day.slots].sort((a, b) => (a.dataVal || '').localeCompare(b.dataVal || ''));
    const candidate = sorted[0];
    if (!earliest || (candidate.dataVal || '').localeCompare(earliest.dataVal || '') < 0) {
      earliest = {
        dateStr: day.date,
        dataVal: candidate.dataVal,
        timeText: candidate.text || candidate.dataVal,
        daySlots: day.slots,
      };
    }
  }
  return earliest;
}

// ============================================================================
// FILE I/O
// ============================================================================

function ensureResultsDir(): void {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
}

function loadHistory(): History {
  try {
    if (fs.existsSync(HISTORY_PATH)) {
      const raw = fs.readFileSync(HISTORY_PATH, 'utf8');
      if (!raw.trim()) return { locations: {}, overall: { changes: [] } };
      return JSON.parse(raw);
    }
  } catch (e: any) {
    console.log(`Failed to read history file: ${e?.message || e}`);
  }
  return { locations: {}, overall: { changes: [] } };
}

function saveHistory(history: History): void {
  try {
    if (!fs.existsSync(HISTORY_DIR)) {
      fs.mkdirSync(HISTORY_DIR, { recursive: true });
    }
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf8');
  } catch (e: any) {
    console.log(`Failed to write history file: ${e?.message || e}`);
  }
}

function monthHistoryPathForLocation(locationName: string): string {
  const safeLoc = (locationName || 'Unknown').replace(/[^A-Za-z0-9]+/g, '_');
  return path.join(HISTORY_DIR, `${MONTH_HISTORY_BASENAME}-${safeLoc}.json`);
}

function loadMonthHistoryForLocation(locationName: string): { location: string; months: Record<string, any> } {
  const filePath = monthHistoryPathForLocation(locationName);
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (!raw.trim()) return { location: locationName, months: {} };
      return JSON.parse(raw);
    }
  } catch (e: any) {
    console.log(`Failed to read month history file for ${locationName}: ${e?.message || e}`);
  }
  return { location: locationName, months: {} };
}

function saveMonthHistoryForLocation(locationName: string, history: { location: string; months: Record<string, any> }): void {
  const filePath = monthHistoryPathForLocation(locationName);
  try {
    if (!fs.existsSync(HISTORY_DIR)) {
      fs.mkdirSync(HISTORY_DIR, { recursive: true });
    }
  } catch (e: any) {
    console.log(`Failed to ensure history directory: ${e?.message || e}`);
    return;
  }
  try {
    fs.writeFileSync(filePath, JSON.stringify(history, null, 2), 'utf8');
  } catch (e: any) {
    console.log(`Failed to write month history file for ${locationName}: ${e?.message || e}`);
  }
}

function recordMonthAppointments(locationName: string, monthKey: string, monthSlots: DaySlots[]): void {
  if (!Array.isArray(monthSlots) || !monthSlots.length || !monthKey) return;
  const history = loadMonthHistoryForLocation(locationName);
  history.location = locationName;
  history.months = history.months || {};
  history.months[monthKey] = {
    capturedAt: new Date().toISOString(),
    month: monthKey,
    byDate: buildMonthByDate(monthSlots),
  };
  saveMonthHistoryForLocation(locationName, history);
}

// ============================================================================
// CHANGE TRACKING
// ============================================================================

function computeDirection(fromDate: string, toDate: string): string {
  const fromMs = toTime(fromDate);
  const toMs = toTime(toDate);
  if (Number.isNaN(fromMs) || !fromDate) return 'new';
  if (Number.isNaN(toMs) || !toDate) return 'unknown';
  if (toMs < fromMs) return 'sooner';
  if (toMs > fromMs) return 'later';
  return 'same';
}

function computeDeltaDays(fromDate: string, toDate: string): number | null {
  const fromMs = toTime(fromDate);
  const toMs = toTime(toDate);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return null;
  return Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000));
}

function recordLocationChange(history: History, result: LocationResult, nowIso: string): HistoryChange | null {
  if (!result || !result.ok || !result.dataVal) return null;
  const loc = result.locationName || 'Unknown';
  const entry = history.locations[loc] || { changes: [] };
  const last = entry.lastDataVal || '';
  const lastDateOnly = (last.split(' ')[0] || '').trim();
  const nextDateOnly = (result.dataVal.split(' ')[0] || '').trim();

  if (last === result.dataVal) {
    entry.lastSeenAt = nowIso;
    entry.lastDateText = result.dateText || '';
    entry.lastTimeText = result.timeText || '';
    history.locations[loc] = entry;
    return null;
  }

  const prevChange = entry.changes[entry.changes.length - 1];
  const deltaMs =
    prevChange && prevChange.changedAt
      ? Date.parse(nowIso) - Date.parse(prevChange.changedAt)
      : null;

  const change: HistoryChange = {
    changedAt: nowIso,
    fromDataVal: last || '',
    fromDateText: entry.lastDateText || '',
    fromTimeText: entry.lastTimeText || '',
    toDataVal: result.dataVal,
    toDateText: result.dateText || '',
    toTimeText: result.timeText || '',
    deltaMs,
    direction: computeDirection(lastDateOnly, nextDateOnly),
    deltaDays: computeDeltaDays(lastDateOnly, nextDateOnly),
  };

  entry.lastDataVal = result.dataVal;
  entry.lastDateText = result.dateText || '';
  entry.lastTimeText = result.timeText || '';
  entry.lastSeenAt = nowIso;
  entry.changes.push(change);
  history.locations[loc] = entry;
  return change;
}

function recordOverallChange(history: History, earliestResult: LocationResult, nowIso: string): HistoryChange | null {
  if (!earliestResult || !earliestResult.ok || !earliestResult.dataVal) return null;
  const overall = history.overall || { changes: [] };
  const last = overall.lastDataVal || '';
  const lastDateOnly = (last.split(' ')[0] || '').trim();
  const nextDateOnly = (earliestResult.dataVal.split(' ')[0] || '').trim();

  if (last === earliestResult.dataVal) {
    overall.lastSeenAt = nowIso;
    overall.lastLocation = earliestResult.locationName || 'Unknown';
    history.overall = overall;
    return null;
  }

  const prevChange = overall.changes[overall.changes.length - 1];
  const deltaMs =
    prevChange && prevChange.changedAt
      ? Date.parse(nowIso) - Date.parse(prevChange.changedAt)
      : null;

  const change: HistoryChange = {
    changedAt: nowIso,
    fromDataVal: last || '',
    toDataVal: earliestResult.dataVal,
    deltaMs,
    direction: computeDirection(lastDateOnly, nextDateOnly),
    deltaDays: computeDeltaDays(lastDateOnly, nextDateOnly),
  };

  overall.lastDataVal = earliestResult.dataVal;
  overall.lastLocation = earliestResult.locationName || 'Unknown';
  overall.lastSeenAt = nowIso;
  overall.changes.push(change);
  history.overall = overall;
  return change;
}

// ============================================================================
// RUN BUFFER (for parallel execution)
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireRunLock(timeoutMs = 30_000): Promise<void> {
  ensureResultsDir();
  const start = Date.now();
  while (true) {
    try {
      const fd = fs.openSync(RUN_LOCK_PATH, 'wx');
      fs.closeSync(fd);
      return;
    } catch {
      if (Date.now() - start > timeoutMs) {
        throw new Error('Timed out waiting for run lock');
      }
      await sleep(150);
    }
  }
}

function releaseRunLock(): void {
  try {
    if (fs.existsSync(RUN_LOCK_PATH)) {
      fs.unlinkSync(RUN_LOCK_PATH);
    }
  } catch {
    // Best effort
  }
}

async function withRunLock<T>(fn: () => Promise<T>): Promise<T> {
  await acquireRunLock();
  try {
    return await fn();
  } finally {
    releaseRunLock();
  }
}

function loadRunBuffer(): RunBuffer {
  ensureResultsDir();
  if (!fs.existsSync(RUN_BUFFER_PATH)) {
    return { runAt: '', results: [] };
  }
  try {
    const raw = fs.readFileSync(RUN_BUFFER_PATH, 'utf8');
    if (!raw.trim()) return { runAt: '', results: [] };
    const parsed = JSON.parse(raw);
    return {
      runAt: parsed.runAt || '',
      results: Array.isArray(parsed.results) ? parsed.results : [],
    };
  } catch {
    return { runAt: '', results: [] };
  }
}

function saveRunBuffer(buffer: RunBuffer): void {
  ensureResultsDir();
  fs.writeFileSync(RUN_BUFFER_PATH, JSON.stringify(buffer, null, 2), 'utf8');
}

function upsertResult(results: LocationResult[], next: LocationResult): void {
  const idx = results.findIndex(
    (r) => r && next && r.locationName === next.locationName
  );
  if (idx >= 0) results[idx] = next;
  else results.push(next);
}

// ============================================================================
// BROWSER HELPERS
// ============================================================================

async function enableRequestBlocking(page: Page): Promise<void> {
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

async function readDatepickerMonthYear(page: Page): Promise<string> {
  return page.$eval('#datepicker .ui-datepicker-title', (el) => {
    const month = (el as any).querySelector('.ui-datepicker-month')?.textContent?.trim() || '';
    const year = (el as any).querySelector('.ui-datepicker-year')?.textContent?.trim() || '';
    return `${month} ${year}`.trim();
  });
}

async function advanceToNextMonth(page: Page): Promise<void> {
  const before = await readDatepickerMonthYear(page);
  const nextButton = page.locator('#datepicker .ui-datepicker-next');
  await nextButton.waitFor({ state: 'visible', timeout: 15_000 });
  await nextButton.click();
  await page.waitForFunction(
    `(() => {
      const title = document.querySelector('#datepicker .ui-datepicker-title');
      if (!title) return false;
      const month = title.querySelector('.ui-datepicker-month')?.textContent?.trim() || '';
      const year = title.querySelector('.ui-datepicker-year')?.textContent?.trim() || '';
      const current = (month + ' ' + year).trim();
      return current && current !== "${before}";
    })()`
  );
}

async function scanVisibleMonth(
  page: Page,
  gear: any,
  locationName: string,
  options: { rangeStart: string; rangeEnd: string; skipWeekends?: boolean } = { rangeStart: '', rangeEnd: '' }
): Promise<ScanResult> {
  const { rangeStart, rangeEnd, skipWeekends = true } = options;
  const dayCells = await page.$$eval('#datepicker td[data-handler="selectDay"]', (els) =>
    els
      .map((el) => {
        const link = el.querySelector('a.ui-state-default');
        if (!link) return null;
        const day = (link.textContent || '').trim();
        const month = el.getAttribute('data-month');
        const year = el.getAttribute('data-year');
        return day ? { day, month, year } : null;
      })
      .filter(Boolean)
  );

  const monthSlots: DaySlots[] = [];
  let eligibleDays = 0;
  for (const d of dayCells as { day: string; month: string; year: string }[]) {
    if (!d) continue;
    const dateStr = `${d.year}-${String(Number(d.month) + 1).padStart(2, '0')}-${d.day.padStart(2, '0')}`;
    if (!isWithinRange(dateStr, rangeStart, rangeEnd)) continue;
    if (skipWeekends && isWeekendDate(dateStr)) continue;
    eligibleDays += 1;

    const dayLocator = page
      .locator(
        `#datepicker td[data-handler="selectDay"][data-month="${d.month}"][data-year="${d.year}"] a.ui-state-default`
      )
      .filter({ hasText: new RegExp(`^${d.day}$`) })
      .first();

    if (!(await dayLocator.count())) continue;

    await dayLocator.click();
    await page.waitForFunction(
      `(() => {
        const wrap = document.querySelector('.time_wrap');
        if (!wrap) return false;
        const slotsInner = wrap.querySelectorAll('.time[data-val]');
        return slotsInner.length > 0;
      })()`,
      { timeout: 60_000 }
    );
    await gear.waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});

    const daySlots = await page.$$eval('.time_wrap .time[data-val]', (els) =>
      els.map((el) => ({
        dataVal: el.getAttribute('data-val') || '',
        text: (el.textContent || '').trim(),
      }))
    );

    monthSlots.push({ date: dateStr, slots: daySlots });
  }

  return {
    monthSlots,
    totalAppointments: countMonthAppointments(monthSlots),
    eligibleDays,
    totalSelectableDays: dayCells.length,
  };
}

// ============================================================================
// MAIN MONITORING FUNCTION
// ============================================================================

export async function getSoonestAppointmentForLocation(
  page: Page,
  locationName: string,
  opts: { forceReload?: boolean } = {}
): Promise<LocationResult> {
  const { forceReload = false } = opts;
  await page.goto(START_URL, { waitUntil: 'domcontentloaded' });

  if (forceReload) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('domcontentloaded');
  }

  await page.getByText('Driver Licensing and').click();

  const makeApptButton = page.locator('#newAppointment');
  const makeApptText = page.locator('#newAppointment >> text=Make Appointment');
  const header = page.getByText('Select location to schedule ticket at');

  if (!(await header.isVisible().catch(() => false))) {
    await page.locator('#start').waitFor({ state: 'visible', timeout: 120_000 });
    await makeApptButton.waitFor({ state: 'visible', timeout: 120_000 });

    try {
      await makeApptButton.click({ timeout: 15_000 });
    } catch {
      await makeApptText.scrollIntoViewIfNeeded().catch(() => {});
      await makeApptText.click({ timeout: 15_000, force: true });
    }
  }

  const spinner = page.locator('.loading > .fa').first();
  const gear = page.locator('.fa-cog, .fa-gear').first();

  if (!(await header.isVisible().catch(() => false))) {
    const headerSeen = await header.waitFor({ timeout: 45_000 }).catch(() => null);
    if (!headerSeen) {
      await makeApptButton.click({ timeout: 15_000 }).catch(async () => {
        await makeApptText.scrollIntoViewIfNeeded().catch(() => {});
        await makeApptText.click({ timeout: 15_000, force: true });
      });
    }
    await header.waitFor({ timeout: 120_000 });
  }

  const locationTile = page
    .locator('.location.button-look.next')
    .filter({ hasText: locationName })
    .first();
  await gear.waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
  await locationTile.waitFor({ state: 'visible', timeout: 30_000 });
  try {
    await locationTile.click({ timeout: 10_000 });
  } catch {
    await locationTile.scrollIntoViewIfNeeded();
    await locationTile.click({ timeout: 30_000, force: true });
  }

  await page.getByText('DRIVER LICENSE & STATE ID Renewals').waitFor({ timeout: 30_000 });
  await gear.waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
  await page.getByText('DRIVER LICENSE & STATE ID Renewals').click();
  await page.waitForLoadState('domcontentloaded');

  const requiredAck = page.getByText('I have ALL the Required');
  await requiredAck.waitFor({ timeout: 30_000 });
  await requiredAck.click();
  await page.waitForLoadState('domcontentloaded');

  const datepicker = page.locator('#datepicker');
  await datepicker.waitFor({ state: 'visible', timeout: 60_000 });
  if (LOG_BOOKING_URL) {
    console.log(`[${locationName}] booking url: ${page.url()}`);
  }

  const dayLink = datepicker.locator('td[data-handler="selectDay"] a.ui-state-default').first();
  if (!(await dayLink.count())) {
    return { locationName, ok: false, reason: 'No available day links found' };
  }
  const firstDay = await dayLink.evaluate((el) => {
    const td = el.closest('td');
    return {
      day: (el.textContent || '').trim(),
      month: td ? td.getAttribute('data-month') : '',
      year: td ? td.getAttribute('data-year') : '',
    };
  });
  await dayLink.click();

  await page.waitForFunction(
    `(() => {
      const wrap = document.querySelector('.time_wrap');
      if (!wrap) return false;
      const slots = wrap.querySelectorAll('.time[data-val]');
      return slots.length > 0;
    })()`,
    { timeout: 60_000 }
  );
  await gear.waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});

  const slots = await page.$$eval('.time_wrap .time[data-val]', (els) =>
    els.map((el) => ({
      dataVal: el.getAttribute('data-val') || '',
      text: (el.textContent || '').trim(),
    }))
  );

  if (!slots.length) {
    return {
      locationName,
      ok: false,
      reason: 'No .time[data-val] slots found after wait',
    };
  }

  const dayNum = String(firstDay.day || '').padStart(2, '0');
  const monthNum = String(Number(firstDay.month || 0) + 1).padStart(2, '0');
  const dateStr = firstDay.year ? `${firstDay.year}-${monthNum}-${dayNum}` : '';
  const sorted = [...slots].sort((a, b) => a.dataVal.localeCompare(b.dataVal));
  const candidate = sorted[0];

  // Soonest appointment is from the first available day shown on page load
  const soonestDateText = dateStr;
  const soonestTimeText = candidate.text || candidate.dataVal;
  const soonestDataVal = candidate.dataVal;
  const soonestDaySlots = slots;

  console.log(`[${locationName}] soonest appointment: ${soonestDataVal} (${soonestDateText} ${soonestTimeText})`);

  // Scan window: tomorrow through 30 days from today
  const hstToday = getHstToday();
  const windowStart = addDays(hstToday, 1); // Start from tomorrow
  const windowEnd = addDays(hstToday, SCAN_WINDOW_DAYS);
  console.log(`[${locationName}] scan window: ${windowStart} to ${windowEnd}`);

  const combinedMonthSlots: DaySlots[] = [];
  let totalEligibleDays = 0;
  let totalSlots = 0;
  const endMonthKey = windowEnd.slice(0, 7);

  while (true) {
    const monthTitle = await readDatepickerMonthYear(page);
    const monthKey = monthKeyFromTitle(monthTitle);
    const scan = await scanVisibleMonth(page, gear, locationName, {
      rangeStart: windowStart,
      rangeEnd: windowEnd,
      skipWeekends: true,
    });
    combinedMonthSlots.push(...scan.monthSlots);
    totalEligibleDays += scan.eligibleDays;
    totalSlots += scan.totalAppointments;
    console.log(
      `[${locationName}] scan ${monthTitle} (${monthKey}) eligibleDays=${scan.eligibleDays}/${scan.totalSelectableDays} appts=${scan.totalAppointments}`
    );

    if (!monthKey || monthKey >= endMonthKey) break;
    await advanceToNextMonth(page);
  }

  console.log(`[${locationName}] window summary scannedDays=${totalEligibleDays} slots=${totalSlots}`);

  return {
    locationName,
    ok: true,
    dateText: soonestDateText,
    timeText: soonestTimeText,
    dataVal: soonestDataVal,
    daySlots: soonestDaySlots,
    monthSlots: combinedMonthSlots,
  };
}

// ============================================================================
// FINALIZATION
// ============================================================================

export async function finalizeRun(results: LocationResult[], runAt?: string): Promise<void> {
  const nowIso = runAt || new Date().toISOString();
  const history = loadHistory();

  const okCount = results.filter((r) => r && r.ok).length;
  console.log(`Done. Locations checked: ${results.length}, successes: ${okCount}`);

  for (const res of results) {
    if (res && res.ok) {
      recordLocationChange(history, res, nowIso);
    }
  }

  const earliest = [...results]
    .filter((r) => r && r.ok && r.dataVal)
    .sort((a, b) => (a.dataVal || '').localeCompare(b.dataVal || ''))[0];

  recordOverallChange(history, earliest, nowIso);

  history.lastRunAt = nowIso;
  saveHistory(history);

  const resolvedTargetDate = TARGET_DATE_ENV || todayPlus(60);
  const resolvedWindowDays = TARGET_WINDOW_ENV === '' ? 60 : Number(TARGET_WINDOW_ENV || 0);

  let alerts: LocationResult[] = [];
  if (resolvedTargetDate) {
    const targetTime = toTime(resolvedTargetDate);
    const windowMs = Math.abs(resolvedWindowDays) * 24 * 60 * 60 * 1000;
    alerts = results.filter((r) => {
      if (!r.ok || !r.dataVal) return false;
      const slotDate = r.dataVal.split(' ')[0];
      const slotTime = toTime(slotDate);
      if (Number.isNaN(slotTime) || Number.isNaN(targetTime)) return false;
      return slotTime >= targetTime - windowMs && slotTime <= targetTime + windowMs;
    });
  }

  const outPath = path.join(RESULTS_DIR, 'dmv-results.json');
  const payload = {
    generatedAt: nowIso,
    targetDate: resolvedTargetDate,
    targetWindowDays: resolvedWindowDays,
    results,
    alerts,
  };
  try {
    ensureResultsDir();
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`Wrote results to ${outPath}`);
  } catch (e: any) {
    console.log(`Failed to write ${outPath}: ${e?.message || e}`);
  }
}

export async function appendResultAndFinalizeIfComplete(result: LocationResult): Promise<void> {
  await withRunLock(async () => {
    const buffer = loadRunBuffer();
    if (!buffer.runAt) buffer.runAt = new Date().toISOString();
    buffer.results = Array.isArray(buffer.results) ? buffer.results : [];
    upsertResult(buffer.results, result);
    saveRunBuffer(buffer);

    const uniqueCount = new Set(
      buffer.results.map((r) => r && r.locationName).filter(Boolean)
    ).size;
    if (uniqueCount >= LOCATIONS.length) {
      await finalizeRun(buffer.results, buffer.runAt);
      try {
        fs.unlinkSync(RUN_BUFFER_PATH);
      } catch {
        // Ignore cleanup errors
      }
    }
  });
}

// ============================================================================
// SINGLE LOCATION RUNNER
// ============================================================================

export async function monitorLocation(
  locationName: string,
  options: { headless?: boolean; slowMo?: number } = {}
): Promise<LocationResult> {
  const { headless = process.env.CI === 'true', slowMo = process.env.CI === 'true' ? 0 : 750 } = options;

  const runAttempt = async (forceReload = false): Promise<LocationResult> => {
    const browser = await chromium.launch({ headless, slowMo });
    const context = await browser.newContext();
    const page = await context.newPage();
    await enableRequestBlocking(page);

    const attemptLabel = forceReload ? 'retry' : 'first';
    const attemptLogs: string[] = [];
    const safeName = locationName.replace(/\s+/g, '_');
    const screenshotDir = path.join(process.cwd(), 'screenshots');
    const screenshotPath = path.join(screenshotDir, `${safeName}-${attemptLabel}-${Date.now()}.png`);

    page.on('console', (msg) => {
      attemptLogs.push(`[${msg.type()}] ${msg.text()}`);
    });

    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    try {
      return await getSoonestAppointmentForLocation(page, locationName, { forceReload });
    } catch (e: any) {
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`[${locationName}] ${attemptLabel} attempt screenshot saved: ${screenshotPath}`);
      } catch (sErr: any) {
        console.log(`[${locationName}] ${attemptLabel} attempt screenshot failed: ${sErr?.message || sErr}`);
      }
      if (attemptLogs.length) {
        console.log(`[${locationName}] ${attemptLabel} attempt console logs:\n${attemptLogs.join('\n')}`);
      }
      throw e;
    } finally {
      await context.close();
      await browser.close();
    }
  };

  let res: LocationResult | undefined;
  try {
    res = await runAttempt(false);
  } catch (e: any) {
    console.log(`[${locationName}] first attempt error: ${e?.message || e} — retrying with hard reload`);
  }

  if (!res) {
    try {
      res = await runAttempt(true);
    } catch (e2: any) {
      res = {
        locationName,
        ok: false,
        reason: e2?.message || String(e2),
      };
      console.log(`[${locationName}] retry error: ${e2?.message || e2}`);
    }
  }

  if (res && res.ok) {
    console.log(`[${locationName}] soonest: ${res.dataVal} (${res.dateText} ${res.timeText})`);
    if (res.monthSlots) {
      const monthlySummary = summarizeMonthSlots(res.monthSlots);
      if (monthlySummary) {
        const dispLoc = (locationName || 'Unknown').replace(/\s*Satellite City Hall$/i, '').trim() || locationName;
        console.log(`[${dispLoc}] monthly ${monthlySummary.monthLabel}: ${monthlySummary.totalAppts} appt(s)`);
      }
      const monthGroups = splitMonthSlotsByMonth(res.monthSlots);
      for (const [monthKey, slots] of Object.entries(monthGroups)) {
        recordMonthAppointments(locationName, monthKey, slots);
      }
    }
  } else {
    console.log(`[${locationName}] no result: ${res ? res.reason : 'unknown error'}`);
  }

  await appendResultAndFinalizeIfComplete(res);

  return res;
}
