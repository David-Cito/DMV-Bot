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

// Persistent history of soonest-slot changes.
const HISTORY_PATH = path.join(process.cwd(), 'dmv-history.json');

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
      return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    }
  } catch (e) {
    console.log(`Failed to read history file: ${e && e.message ? e.message : e}`);
  }
  return { locations: {}, overall: { changes: [] } };
}

function saveHistory(history) {
  try {
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf8');
    console.log(`Updated history at ${HISTORY_PATH}`);
  } catch (e) {
    console.log(`Failed to write history file: ${e && e.message ? e.message : e}`);
  }
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

async function getSoonestAppointmentForLocation(page, locationName, opts = {}) {
  const { forceReload = false } = opts;
  await page.goto(START_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');

  // Optional hard refresh to recover from flaky first-load states.
  if (forceReload) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
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
  await page.waitForLoadState('networkidle');

  // "I have ALL the Required ..." acknowledgement (text varies slightly, so keep it partial)
  const requiredAck = page.getByText('I have ALL the Required');
  await requiredAck.waitFor({ timeout: 30_000 });
  await requiredAck.click();
  await page.waitForLoadState('networkidle');

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

  // Sort by the machine-readable timestamp; format is "YYYY-MM-DD HH:mm:ss"
  // so simple string comparison works.
  slots.sort((a, b) => a.dataVal.localeCompare(b.dataVal));
  const earliest = slots[0];

  const dateHeader =
    (await page.locator('#time_wrap_date').textContent())?.trim() || '';
  const dateFromDataVal = earliest.dataVal.split(' ')[0] || '';

  return {
    locationName,
    ok: true,
    dateText: dateHeader || dateFromDataVal,
    timeText: earliest.text || earliest.dataVal,
    dataVal: earliest.dataVal,
  };
}

test('dmv appointment bot - check soonest appointments by location', async ({
  browser,
}) => {
  const results = [];
  const history = loadHistory();
  const nowIso = new Date().toISOString();
  const changeLog = [];

  for (const locationName of LOCATIONS) {
    // Helper to run one attempt (optionally with hard reload) and clean up its context.
    const runAttempt = async (forceReload = false) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const attemptLabel = forceReload ? 'retry' : 'first';
      const attemptLogs = [];
      const safeName = locationName.replace(/\s+/g, '_');
      const screenshotDir = path.join(process.cwd(), 'screenshots');
      const screenshotPath = path.join(
        screenshotDir,
        `${safeName}-${attemptLabel}-${Date.now()}.png`
      );

      // Capture console logs for debugging.
      page.on('console', (msg) => {
        attemptLogs.push(`[${msg.type()}] ${msg.text()}`);
      });

      // Ensure screenshot directory exists.
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }

      try {
        const res = await getSoonestAppointmentForLocation(page, locationName, {
          forceReload,
        });
        return res;
      } catch (e) {
        // Take a screenshot on failure for diagnostics.
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

    // Retry once with hard reload if first attempt threw.
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

    results.push(res);
    if (res && res.ok) {
      console.log(
        `[${locationName}] soonest: ${res.dataVal} (${res.dateText} ${res.timeText})`
      );
      const locChange = recordLocationChange(history, res, nowIso);
      if (locChange) {
        changeLog.push({
          type: 'location',
          location: locationName,
          to: res.dataVal,
          from: locChange.fromDataVal,
          delta: locChange.deltaMs,
          deltaDays: locChange.deltaDays,
          direction: locChange.direction,
        });
      }
    } else {
      console.log(`[${locationName}] no result: ${res ? res.reason : 'unknown error'}`);
    }

    // Keep the page open only when running locally so you can visually inspect
    // the times. In CI we skip this pause to avoid hitting test timeouts.
    if (!process.env.CI) {
      // Give a moment to observe before moving to next location.
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  console.log(`Done. Locations checked: ${results.length}, successes: ${okCount}`);

  // Track overall earliest change across all locations.
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

  if (changeLog.length) {
    console.log('Change log (this run):');
    changeLog.forEach((c) => {
      const scope = c.type === 'overall' ? 'OVERALL' : c.location;
      console.log(
        `- ${scope}: ${c.from || 'none'} -> ${c.to} (Δ ${formatDuration(c.delta)}; ${c.direction} ${c.deltaDays ?? 'n/a'}d)`
      );
    });
  } else {
    console.log('No soonest-date changes detected this run.');
  }

  history.lastRunAt = nowIso;
  saveHistory(history);

  // If a target date is provided, surface any slots within ±window days of that date.
  const resolvedTargetDate = TARGET_DATE_ENV || todayPlus(60);
  const resolvedWindowDays =
    TARGET_WINDOW_ENV === '' ? 60 : Number(TARGET_WINDOW_ENV || 0);

  let alerts = [];
  if (resolvedTargetDate) {
    const targetTime = toTime(resolvedTargetDate);
    const windowMs = Math.abs(resolvedWindowDays) * 24 * 60 * 60 * 1000;
    alerts = results.filter(
      (r) => {
        if (!r.ok || !r.dataVal) return false;
        const slotDate = r.dataVal.split(' ')[0];
        const slotTime = toTime(slotDate);
        if (Number.isNaN(slotTime) || Number.isNaN(targetTime)) return false;
        return slotTime >= targetTime - windowMs && slotTime <= targetTime + windowMs;
      }
    );
    if (alerts.length) {
      console.log(
        `NOTIFY: slots within ±${resolvedWindowDays}d of ${resolvedTargetDate} -> ${JSON.stringify(
          alerts
        )}`
      );
    } else {
      console.log(
        `NOTIFY: none within ±${resolvedWindowDays}d of ${resolvedTargetDate}`
      );
    }
  }

  // Persist results for CI/notification steps.
  const outPath = path.join(process.cwd(), 'dmv-results.json');
  const payload = {
    generatedAt: new Date().toISOString(),
    targetDate: resolvedTargetDate,
    targetWindowDays: resolvedWindowDays,
    results,
    alerts,
  };
  try {
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`Wrote results to ${outPath}`);
  } catch (e) {
    console.log(`Failed to write ${outPath}: ${e && e.message ? e.message : e}`);
  }
});