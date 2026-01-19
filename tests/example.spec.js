const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const START_URL =
  'https://alohaq.honolulu.gov/';

// Buttons shown on the "Select location to schedule ticket at" page.
const LOCATIONS = [
  'Downtown Satellite City Hall',
  'Hawaii Kai Satellite City Hall',
  'Pearlridge Satellite City Hall',
  'Windward City Satellite City Hall',
];

// Optional threshold date (YYYY-MM-DD) and window days (±) to decide if a slot is "interesting".
// You can change these via env DMV_TARGET_DATE and DMV_TARGET_WINDOW_DAYS at runtime.
// If TARGET_DATE is empty, we default to today + 60 days. If window is empty, default to 60 days.
const TARGET_DATE_ENV = process.env.DMV_TARGET_DATE || '';
const TARGET_WINDOW_ENV = process.env.DMV_TARGET_WINDOW_DAYS || '';
const TEST_VARIANT = 'single bot';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ordinalSuffix(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function formatHumanDate(dateStr) {
  if (!dateStr) return 'Unknown date';
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  const day = d.getUTCDate();
  const weekday = WEEKDAY_NAMES[d.getUTCDay()];
  const month = MONTH_NAMES[d.getUTCMonth()];
  return `${weekday}, ${month} ${day}${ordinalSuffix(day)}`;
}

function formatHumanMonth(dateStr) {
  if (!dateStr) return 'Unknown month';
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr.slice(0, 7) || dateStr;
  const month = MONTH_NAMES[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  return `${month} ${year}`;
}

function formatSlotTime(slot) {
  const text = slot && slot.text ? slot.text.trim() : '';
  if (text) return text;
  const raw = slot && slot.dataVal ? (slot.dataVal.split(' ')[1] || '') : '';
  if (!raw) return '';
  const [hh = '', mm = '00'] = raw.split(':');
  const hourNum = Number(hh);
  if (Number.isNaN(hourNum)) return raw;
  const ampm = hourNum >= 12 ? 'PM' : 'AM';
  const hour12 = ((hourNum + 11) % 12) + 1;
  return `${hour12}:${mm.padStart(2, '0')} ${ampm}`;
}

function formatMonthSlotsForConsole(monthSlots) {
  if (!Array.isArray(monthSlots) || !monthSlots.length) return null;
  const sortedDays = monthSlots
    .filter((d) => d && d.date)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (!sortedDays.length) return null;

  const lines = sortedDays.map((day) => {
    const sortedSlots = Array.isArray(day.slots)
      ? [...day.slots].sort((a, b) => (a.dataVal || '').localeCompare(b.dataVal || ''))
      : [];
    const times = sortedSlots.map((s) => formatSlotTime(s)).filter(Boolean);
    const timeText = times.length ? times.join(', ') : '(no times listed)';
    return `  - ${formatHumanDate(day.date)}: ${timeText}`;
  });

  return {
    monthLabel: formatHumanMonth(sortedDays[0].date),
    lines,
  };
}

function summarizeMonthSlots(monthSlots) {
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

function extractTimePart(slot) {
  const dataVal = (slot && slot.dataVal) || '';
  return dataVal.split(' ')[1] || '';
}

function buildTimeList(slots) {
  if (!Array.isArray(slots)) return [];
  return [...slots]
    .map((s) => extractTimePart(s))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function buildMonthByDate(monthSlots) {
  if (!Array.isArray(monthSlots)) return {};
  const byDate = {};
  for (const day of monthSlots) {
    if (!day || !day.date) continue;
    byDate[day.date] = buildTimeList(day.slots);
  }
  return byDate;
}

function splitMonthSlotsByMonth(monthSlots) {
  const grouped = {};
  for (const day of monthSlots || []) {
    if (!day || !day.date) continue;
    const key = day.date.slice(0, 7);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(day);
  }
  return grouped;
}

// Persistent history of soonest-slot changes.
const DATA_DIR = path.join(process.cwd(), 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const HISTORY_PATH = path.join(HISTORY_DIR, 'dmv-history.json');
const MONTH_HISTORY_BASENAME = 'dmv-month-history';
const RESULTS_DIR = path.join(DATA_DIR, 'results');
const RUN_BUFFER_PATH = path.join(RESULTS_DIR, 'dmv-run-buffer.json');
const RUN_LOCK_PATH = path.join(RESULTS_DIR, '.dmv-run.lock');

function toTime(dateStr) {
  // Expects YYYY-MM-DD; returns ms or NaN.
  return Date.parse(dateStr);
}

function todayPlus(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  const iso = d.toISOString().slice(0, 10); // YYYY-MM-DD
  return iso;
}

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_PATH)) {
      const raw = fs.readFileSync(HISTORY_PATH, 'utf8');
      if (!raw.trim()) return { locations: {}, overall: { changes: [] } };
      return JSON.parse(raw);
    }
  } catch (e) {
    console.log(`Failed to read history file: ${e && e.message ? e.message : e}`);
  }
  return { locations: {}, overall: { changes: [] } };
}

function monthHistoryPathForLocation(locationName) {
  const safeLoc = (locationName || 'Unknown').replace(/[^A-Za-z0-9]+/g, '_');
  return path.join(HISTORY_DIR, `${MONTH_HISTORY_BASENAME}-${safeLoc}.json`);
}

function loadMonthHistoryForLocation(locationName) {
  const filePath = monthHistoryPathForLocation(locationName);
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (!raw.trim()) return { location: locationName, months: {} };
      return JSON.parse(raw);
    }
  } catch (e) {
    console.log(`Failed to read month history file for ${locationName}: ${e && e.message ? e.message : e}`);
  }
  return { location: locationName, months: {} };
}

function saveHistory(history) {
  try {
    if (!fs.existsSync(HISTORY_DIR)) {
      fs.mkdirSync(HISTORY_DIR, { recursive: true });
    }
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf8');
  } catch (e) {
    console.log(`Failed to write history file: ${e && e.message ? e.message : e}`);
  }
}

function saveMonthHistoryForLocation(locationName, history) {
  const filePath = monthHistoryPathForLocation(locationName);
  try {
    if (!fs.existsSync(HISTORY_DIR)) {
      fs.mkdirSync(HISTORY_DIR, { recursive: true });
    }
  } catch (e) {
    console.log(`Failed to ensure history directory: ${e && e.message ? e.message : e}`);
    return;
  }
  try {
    fs.writeFileSync(filePath, JSON.stringify(history, null, 2), 'utf8');
  } catch (e) {
    console.log(`Failed to write month history file for ${locationName}: ${e && e.message ? e.message : e}`);
  }
}

function recordMonthAppointments(locationName, monthKey, monthSlots) {
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

function recordLocationChange(history, result, nowIso) {
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
    return null; // No change.
  }

  const prevChange = entry.changes[entry.changes.length - 1];
  const deltaMs =
    prevChange && prevChange.changedAt
      ? Date.parse(nowIso) - Date.parse(prevChange.changedAt)
      : null;

  const change = {
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

function recordOverallChange(history, earliestResult, nowIso) {
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

  const change = {
    changedAt: nowIso,
    fromDataVal: last || '',
    fromLocation: overall.lastLocation || '',
    toDataVal: earliestResult.dataVal,
    toLocation: earliestResult.locationName || 'Unknown',
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

function computeDirection(fromDate, toDate) {
  const fromMs = toTime(fromDate);
  const toMs = toTime(toDate);
  if (Number.isNaN(fromMs) || !fromDate) return 'new';
  if (Number.isNaN(toMs) || !toDate) return 'unknown';
  if (toMs < fromMs) return 'sooner';
  if (toMs > fromMs) return 'later';
  return 'same';
}

function computeDeltaDays(fromDate, toDate) {
  const fromMs = toTime(fromDate);
  const toMs = toTime(toDate);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return null;
  return Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000));
}

function formatDuration(ms) {
  if (ms == null || Number.isNaN(ms)) return 'n/a';
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  const parts = [];
  if (day) parts.push(`${day}d`);
  if (hr % 24) parts.push(`${hr % 24}h`);
  if (min % 60) parts.push(`${min % 60}m`);
  if (parts.length === 0) parts.push(`${sec}s`);
  return parts.join(' ');
}

function ensureResultsDir() {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireRunLock(timeoutMs = 30_000) {
  ensureResultsDir();
  const start = Date.now();
  while (true) {
    try {
      const fd = fs.openSync(RUN_LOCK_PATH, 'wx');
      fs.closeSync(fd);
      return;
    } catch (e) {
      if (Date.now() - start > timeoutMs) {
        throw new Error('Timed out waiting for run lock');
      }
      await sleep(150);
    }
  }
}

function releaseRunLock() {
  try {
    if (fs.existsSync(RUN_LOCK_PATH)) {
      fs.unlinkSync(RUN_LOCK_PATH);
    }
  } catch {
    // Best effort; lock will expire on next run.
  }
}

async function withRunLock(fn) {
  await acquireRunLock();
  try {
    return await fn();
  } finally {
    releaseRunLock();
  }
}

function loadRunBuffer() {
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

function saveRunBuffer(buffer) {
  ensureResultsDir();
  fs.writeFileSync(RUN_BUFFER_PATH, JSON.stringify(buffer, null, 2), 'utf8');
}

function upsertResult(results, next) {
  const idx = results.findIndex(
    (r) => r && next && r.locationName === next.locationName
  );
  if (idx >= 0) results[idx] = next;
  else results.push(next);
}

function countMonthAppointments(monthSlots) {
  if (!Array.isArray(monthSlots)) return 0;
  return monthSlots.reduce((sum, day) => sum + ((day && day.slots && day.slots.length) || 0), 0);
}

function findEarliestSlot(monthSlots) {
  let earliest = null;
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
  await page.waitForFunction(
    (prev) => {
      const title = document.querySelector('#datepicker .ui-datepicker-title');
      if (!title) return false;
      const month = title.querySelector('.ui-datepicker-month')?.textContent?.trim() || '';
      const year = title.querySelector('.ui-datepicker-year')?.textContent?.trim() || '';
      return `${month} ${year}`.trim() && `${month} ${year}`.trim() !== prev;
    },
    before,
    { timeout: 15_000 }
  );
}

async function scanVisibleMonth(page, gear, locationName) {
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

  const monthSlots = [];
  for (const d of dayCells) {
    const dayLocator = page
      .locator(
        `#datepicker td[data-handler="selectDay"][data-month="${d.month}"][data-year="${d.year}"] a.ui-state-default`
      )
      .filter({ hasText: new RegExp(`^${d.day}$`) })
      .first();

    if (!(await dayLocator.count())) continue;

    await dayLocator.click();
    await page.waitForFunction(
      () => {
        const wrap = document.querySelector('.time_wrap');
        if (!wrap) return false;
        const slotsInner = wrap.querySelectorAll('.time[data-val]');
        return slotsInner.length > 0;
      },
      { timeout: 60_000 }
    );
    await gear.waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});

    const daySlots = await page.$$eval('.time_wrap .time[data-val]', (els) =>
      els.map((el) => ({
        dataVal: el.getAttribute('data-val') || '',
        text: (el.textContent || '').trim(),
      }))
    );

    const dateStr = `${d.year}-${String(Number(d.month) + 1).padStart(2, '0')}-${d.day.padStart(
      2,
      '0'
    )}`;
    monthSlots.push({ date: dateStr, slots: daySlots });
  }

  return { monthSlots, totalAppointments: countMonthAppointments(monthSlots) };
}

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

async function getSoonestAppointmentForLocation(page, locationName, opts = {}) {
  const { forceReload = false } = opts;
  await page.goto(START_URL, { waitUntil: 'domcontentloaded' });

  // Optional hard refresh to recover from flaky first-load states.
  if (forceReload) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('domcontentloaded');
  }

  await page.getByText('Driver Licensing and').click();

  // The "Make Appointment" control: target the explicit element on the start screen.
  const makeApptButton = page.locator('#newAppointment');
  const makeApptText = page.locator('#newAppointment >> text=Make Appointment');
  const header = page.getByText('Select location to schedule ticket at');

  // If we've already advanced (header visible), skip clicking again.
  if (!(await header.isVisible().catch(() => false))) {
    // Wait for the start section and the button to be visible.
    await page.locator('#start').waitFor({ state: 'visible', timeout: 120_000 });
    await makeApptButton.waitFor({ state: 'visible', timeout: 120_000 });

    try {
      await makeApptButton.click({ timeout: 15_000 });
    } catch {
      await makeApptText.scrollIntoViewIfNeeded().catch(() => {});
      await makeApptText.click({ timeout: 15_000, force: true });
    }
  }

  // Wait for transition to the locations page. The spinner/gear may appear briefly.
  const spinner = page.locator('.loading > .fa').first();
  const gear = page.locator('.fa-cog, .fa-gear').first();

  // If already on the locations page, skip all waits.
  if (!(await header.isVisible().catch(() => false))) {
    // Wait for header; if not seen in 45s, retry the click once.
    const headerSeen = await header.waitFor({ timeout: 45_000 }).catch(() => null);
    if (!headerSeen) {
      await makeApptButton.click({ timeout: 15_000 }).catch(async () => {
        await makeApptText.scrollIntoViewIfNeeded().catch(() => {});
        await makeApptText.click({ timeout: 15_000, force: true });
      });
    }
    // Final hard wait for header.
    await header.waitFor({ timeout: 120_000 });
  }

  // Location pick (wait for loader/gear to be gone before clicking)
  const locationTile = page
    .locator('.location.button-look.next')
    .filter({ hasText: locationName })
    .first();
  await gear.waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
  await locationTile.waitFor({ state: 'visible', timeout: 30_000 });
  try {
    // Avoid scrolling too early; try clicking as-is first.
    await locationTile.click({ timeout: 10_000 });
  } catch {
    // If it isn't clickable yet (overlay/position), scroll right before retrying.
    await locationTile.scrollIntoViewIfNeeded();
    await locationTile.click({ timeout: 30_000, force: true });
  }

  // Service pick (adjust if you want a different service)
  // Wait for the next step UI rather than relying on networkidle (site keeps connections open).
  await page
    .getByText('DRIVER LICENSE & STATE ID Renewals')
    .waitFor({ timeout: 30_000 });
  await gear.waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
  await page
    .getByText('DRIVER LICENSE & STATE ID Renewals')
    .click();
  await page.waitForLoadState('domcontentloaded');

  // "I have ALL the Required ..." acknowledgement (text varies slightly, so keep it partial)
  const requiredAck = page.getByText('I have ALL the Required');
  await requiredAck.waitFor({ timeout: 30_000 });
  await requiredAck.click();
  await page.waitForLoadState('domcontentloaded');

  // Calendar: pick the first available *selectable* day in the jQuery UI datepicker.
  // We explicitly target the datepicker table cells that have `data-handler="selectDay"`
  // (disabled days use spans and lack this attribute).
  const datepicker = page.locator('#datepicker');
  await datepicker.waitFor({ state: 'visible', timeout: 60_000 });

  const dayLink = datepicker
    .locator('td[data-handler="selectDay"] a.ui-state-default')
    .first();
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

  // After choosing a day, the page may show the loading spinner/gear again while it
  // fetches available times. Use a DOM-based readiness check to be robust:
  // wait until at least one `.time` element with `data-val` exists.
  await page.waitForFunction(
    () => {
      const wrap = document.querySelector('.time_wrap');
      if (!wrap) return false;
      const slots = wrap.querySelectorAll('.time[data-val]');
      return slots.length > 0;
    },
    { timeout: 60_000 }
  );
  await gear.waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});

  // Now safely read all available slots from `.time_wrap .time[data-val]`.
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

  const combinedMonthSlots = [];
  const scanCurrent = await scanVisibleMonth(page, gear, locationName);
  combinedMonthSlots.push(...scanCurrent.monthSlots);
  console.log(`[${locationName}] month appts: ${scanCurrent.totalAppointments}`);

  if (scanCurrent.totalAppointments < 10) {
    console.log(`[${locationName}] month appts < 10, scanning next`);
    await advanceToNextMonth(page);
    const scanNext = await scanVisibleMonth(page, gear, locationName);
    combinedMonthSlots.push(...scanNext.monthSlots);
    console.log(`[${locationName}] next month appts: ${scanNext.totalAppointments}`);
  }

  const earliestFromMonths = findEarliestSlot(combinedMonthSlots);
  const earliestDateText = earliestFromMonths?.dateStr || dateStr;
  const earliestTimeText = earliestFromMonths?.timeText || candidate.text || candidate.dataVal;
  const earliestDataVal = earliestFromMonths?.dataVal || candidate.dataVal;
  const earliestDaySlots = earliestFromMonths?.daySlots || slots;

  return {
    locationName,
    ok: true,
    dateText: earliestDateText,
    timeText: earliestTimeText,
    dataVal: earliestDataVal,
    daySlots: earliestDaySlots,
    monthSlots: combinedMonthSlots,
  };
}

async function finalizeRun(results, runAt) {
  const nowIso = runAt || new Date().toISOString();
  const history = loadHistory();
  const changeLog = [];

  const okCount = results.filter((r) => r && r.ok).length;
  console.log(`Done. Locations checked: ${results.length}, successes: ${okCount}`);

  for (const res of results) {
    if (res && res.ok) {
      const locChange = recordLocationChange(history, res, nowIso);
      if (locChange) {
        changeLog.push({
          type: 'location',
          location: res.locationName,
          to: res.dataVal,
          from: locChange.fromDataVal,
          delta: locChange.deltaMs,
          deltaDays: locChange.deltaDays,
          direction: locChange.direction,
        });
      }
    }
  }

  const earliest = [...results]
    .filter((r) => r && r.ok && r.dataVal)
    .sort((a, b) => a.dataVal.localeCompare(b.dataVal))[0];

  const overallChange = recordOverallChange(history, earliest, nowIso);
  if (overallChange) {
    changeLog.push({
      type: 'overall',
      to: overallChange.toDataVal,
      from: overallChange.fromDataVal,
      location: overallChange.toLocation,
      delta: overallChange.deltaMs,
      deltaDays: overallChange.deltaDays,
      direction: overallChange.direction,
    });
  }

  // Suppress detailed change logs to keep output minimal.

  history.lastRunAt = nowIso;
  saveHistory(history);

  const resolvedTargetDate = TARGET_DATE_ENV || todayPlus(60);
  const resolvedWindowDays =
    TARGET_WINDOW_ENV === '' ? 60 : Number(TARGET_WINDOW_ENV || 0);

  let alerts = [];
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
  } catch (e) {
    console.log(`Failed to write ${outPath}: ${e && e.message ? e.message : e}`);
  }
}

async function appendResultAndFinalizeIfComplete(result) {
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
        // Ignore cleanup errors.
      }
    }
  });
}

for (const locationName of LOCATIONS) {
  test(`dmv appointment bot - ${locationName} (${TEST_VARIANT})`, async ({
    browser,
  }) => {
    const runAttempt = async (forceReload = false) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await enableRequestBlocking(page);
      const attemptLabel = forceReload ? 'retry' : 'first';
      const attemptLogs = [];
      const safeName = locationName.replace(/\s+/g, '_');
      const screenshotDir = path.join(process.cwd(), 'screenshots');
      const screenshotPath = path.join(
        screenshotDir,
        `${safeName}-${attemptLabel}-${Date.now()}.png`
      );

      page.on('console', (msg) => {
        attemptLogs.push(`[${msg.type()}] ${msg.text()}`);
      });

      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }

      try {
        return await getSoonestAppointmentForLocation(page, locationName, {
          forceReload,
        });
      } catch (e) {
        try {
          await page.screenshot({ path: screenshotPath, fullPage: true });
          console.log(
            `[${locationName}] ${attemptLabel} attempt screenshot saved: ${screenshotPath}`
          );
        } catch (sErr) {
          console.log(
            `[${locationName}] ${attemptLabel} attempt screenshot failed: ${sErr?.message || sErr}`
          );
        }
        if (attemptLogs.length) {
          console.log(
            `[${locationName}] ${attemptLabel} attempt console logs:\n${attemptLogs.join('\n')}`
          );
        }
        throw e;
      } finally {
        await context.close();
      }
    };

    let res;
    try {
      res = await runAttempt(false);
    } catch (e) {
      console.log(
        `[${locationName}] first attempt error: ${e && e.message ? e.message : e
        } — retrying with hard reload`
      );
    }

    if (!res) {
      try {
        res = await runAttempt(true);
      } catch (e2) {
        res = {
          locationName,
          ok: false,
          reason: e2 && e2.message ? e2.message : String(e2),
        };
        console.log(
          `[${locationName}] retry error: ${e2 && e2.message ? e2.message : e2}`
        );
      }
    }

    if (res && res.ok) {
      console.log(
        `[${locationName}] soonest: ${res.dataVal} (${res.dateText} ${res.timeText})`
      );
      if (res.monthSlots) {
        const monthlySummary = summarizeMonthSlots(res.monthSlots);
        if (monthlySummary) {
          const dispLoc =
            (locationName || 'Unknown').replace(/\s*Satellite City Hall$/i, '').trim() || locationName;
          console.log(
            `[${dispLoc}] monthly ${monthlySummary.monthLabel}: ${monthlySummary.totalAppts} appt(s)`
          );
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

    if (!process.env.CI) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  });
}