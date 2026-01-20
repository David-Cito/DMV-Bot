#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Supabase env vars not set; exiting.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const HST_OFFSET_MS = -10 * 60 * 60 * 1000;

function toHstDateString(date) {
  const hst = new Date(date.getTime() + HST_OFFSET_MS);
  return hst.toISOString().slice(0, 10);
}

function toHstHour(date) {
  const hst = new Date(date.getTime() + HST_OFFSET_MS);
  return hst.getUTCHours();
}

function formatHst(date) {
  return date.toLocaleString('en-US', {
    timeZone: 'Pacific/Honolulu',
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
}

function parseDate(dateStr) {
  if (!dateStr) return NaN;
  return Date.parse(`${dateStr}T00:00:00Z`);
}

function diffDays(fromDateStr, toDateStr) {
  const from = parseDate(fromDateStr);
  const to = parseDate(toDateStr);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx];
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

async function fetchAll(table, columns, applyFilters) {
  const pageSize = 1000;
  let from = 0;
  const out = [];
  while (true) {
    let query = supabase.from(table).select(columns).range(from, from + pageSize - 1);
    if (applyFilters) query = applyFilters(query);
    const { data, error } = await query;
    if (error) throw error;
    out.push(...data);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

const WINDOWS = [1, 3, 7, 14, 30, 60];
const EXCLUSIVE_BUCKETS = [
  { key: '0-7', min: 0, max: 7 },
  { key: '8-14', min: 8, max: 14 },
  { key: '15-30', min: 15, max: 30 },
  { key: '31-60', min: 31, max: 60 },
];

function initWindowStats() {
  return {
    hitCount: 0,
    newCount: 0,
    durationsMin: [],
    hourBuckets: Array.from({ length: 24 }, () => 0),
  };
}

function getExclusiveKey(lead) {
  if (lead == null) return null;
  const bucket = EXCLUSIVE_BUCKETS.find((b) => lead >= b.min && lead <= b.max);
  return bucket ? bucket.key : null;
}

async function main() {
  const now = new Date();
  const windowHours = 6;
  const lookbackHours = 48;
  const windowStart = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const windowEnd = now;
  const windowStartIso = windowStart.toISOString();
  const windowEndIso = windowEnd.toISOString();
  const lookbackStart = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);
  const lookbackStartIso = lookbackStart.toISOString();

  const { data: locations, error: locErr } = await supabase
    .from('locations')
    .select('id,name');
  if (locErr) throw locErr;

  const daySnapshots = await fetchAll(
    'day_snapshots',
    'location_id,captured_at,date',
    (q) => q.gte('captured_at', windowStartIso)
  );

  const slotStates = await fetchAll(
    'slot_states',
    'location_id,date,time,first_seen,last_seen',
    (q) => q.gte('first_seen', windowStartIso).lt('first_seen', windowEndIso)
  );

  const perLocation = {};
  for (const loc of locations || []) {
    const windowStats = {};
    WINDOWS.forEach((days) => {
      windowStats[days] = initWindowStats();
    });
    const exclusiveStats = {};
    EXCLUSIVE_BUCKETS.forEach((bucket) => {
      exclusiveStats[bucket.key] = initWindowStats();
    });
    perLocation[loc.id] = {
      locationId: loc.id,
      locationName: loc.name,
      snapshotsCount: 0,
      windowStats,
      exclusiveStats,
    };
  }

  for (const snap of daySnapshots || []) {
    const loc = perLocation[snap.location_id];
    if (!loc) continue;
    const capturedDate = toHstDateString(new Date(snap.captured_at));
    const lead = diffDays(capturedDate, snap.date);
    if (lead == null) continue;
    loc.snapshotsCount += 1;
    WINDOWS.forEach((days) => {
      if (lead <= days) loc.windowStats[days].hitCount += 1;
    });
    const exclusiveKey = getExclusiveKey(lead);
    if (exclusiveKey) loc.exclusiveStats[exclusiveKey].hitCount += 1;
  }

  for (const entry of slotStates || []) {
    if (!entry || !entry.location_id || !entry.first_seen) continue;
    const firstSeen = new Date(entry.first_seen);
    if (firstSeen < windowStart || firstSeen > windowEnd) continue;
    const capturedDate = toHstDateString(firstSeen);
    const lead = diffDays(capturedDate, entry.date);
    if (lead == null) continue;
    const loc = perLocation[entry.location_id];
    if (!loc) continue;
    const lastSeen = entry.last_seen ? new Date(entry.last_seen) : firstSeen;
    const durationMin = Math.max(0, (lastSeen - firstSeen) / (60 * 1000));
    const hour = toHstHour(firstSeen);
    WINDOWS.forEach((days) => {
      if (lead <= days) {
        const stats = loc.windowStats[days];
        stats.newCount += 1;
        stats.durationsMin.push(durationMin);
        stats.hourBuckets[hour] += 1;
      }
    });
    const exclusiveKey = getExclusiveKey(lead);
    if (exclusiveKey) {
      const stats = loc.exclusiveStats[exclusiveKey];
      stats.newCount += 1;
      stats.durationsMin.push(durationMin);
      stats.hourBuckets[hour] += 1;
    }
  }

  const perLocationMetrics = Object.values(perLocation).map((loc) => {
    const windows = {};
    WINDOWS.forEach((days) => {
      const stats = loc.windowStats[days];
      const avgDuration = average(stats.durationsMin);
      const medianDuration = percentile(stats.durationsMin, 0.5);
      const hitRate = loc.snapshotsCount
        ? Number((stats.hitCount / loc.snapshotsCount).toFixed(4))
        : null;
      const maxHour = Math.max(...stats.hourBuckets);
      const avgHour = stats.newCount ? stats.newCount / windowHours : 0;
      const burstiness = avgHour
        ? Number((maxHour / avgHour).toFixed(2))
        : null;
      windows[days] = {
        new_count: stats.newCount,
        avg_duration_min: avgDuration,
        median_duration_min: medianDuration,
        hit_rate: hitRate,
        burstiness_ratio: burstiness,
      };
    });

    const exclusiveWindows = {};
    EXCLUSIVE_BUCKETS.forEach((bucket) => {
      const stats = loc.exclusiveStats[bucket.key];
      const avgDuration = average(stats.durationsMin);
      const medianDuration = percentile(stats.durationsMin, 0.5);
      const hitRate = loc.snapshotsCount
        ? Number((stats.hitCount / loc.snapshotsCount).toFixed(4))
        : null;
      const maxHour = Math.max(...stats.hourBuckets);
      const avgHour = stats.newCount ? stats.newCount / windowHours : 0;
      const burstiness = avgHour
        ? Number((maxHour / avgHour).toFixed(2))
        : null;
      exclusiveWindows[bucket.key] = {
        new_count: stats.newCount,
        avg_duration_min: avgDuration,
        median_duration_min: medianDuration,
        hit_rate: hitRate,
        burstiness_ratio: burstiness,
      };
    });

    return {
      location_id: loc.locationId,
      location_name: loc.locationName,
      windows,
      exclusive_windows: exclusiveWindows,
    };
  });

  const totalsByWindow = {};
  WINDOWS.forEach((days) => {
    const allDurations = [];
    let totalNew = 0;
    perLocationMetrics.forEach((loc) => {
      const w = loc.windows[days];
      totalNew += w.new_count || 0;
      if (Array.isArray(perLocation[loc.location_id]?.windowStats?.[days]?.durationsMin)) {
        allDurations.push(...perLocation[loc.location_id].windowStats[days].durationsMin);
      }
    });
    totalsByWindow[days] = {
      new_count: totalNew,
      avg_duration_min: average(allDurations),
      median_duration_min: percentile(allDurations, 0.5),
    };
  });

  const totalsByExclusive = {};
  EXCLUSIVE_BUCKETS.forEach((bucket) => {
    const allDurations = [];
    let totalNew = 0;
    perLocationMetrics.forEach((loc) => {
      const w = (loc.exclusive_windows || {})[bucket.key] || {};
      totalNew += w.new_count || 0;
      const stats = perLocation[loc.location_id]?.exclusiveStats?.[bucket.key];
      if (stats && Array.isArray(stats.durationsMin)) {
        allDurations.push(...stats.durationsMin);
      }
    });
    totalsByExclusive[bucket.key] = {
      new_count: totalNew,
      avg_duration_min: average(allDurations),
      median_duration_min: percentile(allDurations, 0.5),
    };
  });

  const metrics = {
    window_start: windowStartIso,
    window_end: windowEndIso,
    totals_by_window: totalsByWindow,
    totals_by_exclusive: totalsByExclusive,
    per_location: perLocationMetrics,
  };

  const formatMinutes = (value) =>
    value == null ? 'n/a' : `${value.toFixed(1)}m`;
  const formatPercent = (value) =>
    value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
  const formatBurst = (value) =>
    value == null ? 'n/a' : `${value.toFixed(1)}x`;

  const textLines = [];
  textLines.push('6-Hour Summary');
  textLines.push(`Window: ${formatHst(windowStart)} - ${formatHst(windowEnd)}`);
  textLines.push('Exclusive ranges (all locations):');
  EXCLUSIVE_BUCKETS.forEach((bucket) => {
    const total = totalsByExclusive[bucket.key] || {};
    textLines.push(
      `${bucket.key} days: new ${total.new_count ?? 0} | avg ${formatMinutes(
        total.avg_duration_min
      )} | median ${formatMinutes(total.median_duration_min)}`
    );
  });
  textLines.push('');
  textLines.push('Exclusive ranges (per location):');
  EXCLUSIVE_BUCKETS.forEach((bucket) => {
    textLines.push('');
    textLines.push(`${bucket.key} days:`);
    perLocationMetrics.forEach((loc) => {
      const w = (loc.exclusive_windows || {})[bucket.key] || {};
      textLines.push(
        `${loc.location_name}: ${w.new_count ?? 0} new | avg ${formatMinutes(
          w.avg_duration_min
        )} | median ${formatMinutes(
          w.median_duration_min
        )} | hit ${formatPercent(w.hit_rate)} | burst ${formatBurst(
          w.burstiness_ratio
        )}`
      );
    });
  });
  textLines.push('');
  textLines.push('How to read:');
  textLines.push('- Higher new count = higher short-term demand.');
  textLines.push('- avg = average availability duration in minutes (last_seen - first_seen).');
  textLines.push('- med = median availability duration in minutes.');
  textLines.push('- Shorter med = higher competition.');
  textLines.push('- Lower hit = queue needs faster checks.');
  textLines.push('- burst = max hourly new slots / avg hourly new slots.');

  const htmlLines = [];
  htmlLines.push('<h2>6-Hour Summary</h2>');
  htmlLines.push(
    `<p><strong>Window:</strong> ${formatHst(windowStart)} - ${formatHst(windowEnd)}</p>`
  );
  htmlLines.push('<h3>Exclusive ranges (all locations)</h3>');
  htmlLines.push('<ul>');
  EXCLUSIVE_BUCKETS.forEach((bucket) => {
    const total = totalsByExclusive[bucket.key] || {};
    htmlLines.push(
      `<li><strong>${bucket.key} days</strong>: new ${total.new_count ?? 0} | avg ${formatMinutes(
        total.avg_duration_min
      )} | median ${formatMinutes(total.median_duration_min)}</li>`
    );
  });
  htmlLines.push('</ul>');
  htmlLines.push('<h3>Exclusive ranges (per location)</h3>');
  EXCLUSIVE_BUCKETS.forEach((bucket) => {
    htmlLines.push(`<h4>${bucket.key} days</h4>`);
    htmlLines.push('<ul>');
    perLocationMetrics.forEach((loc) => {
      const w = (loc.exclusive_windows || {})[bucket.key] || {};
      htmlLines.push(
        `<li><strong>${loc.location_name}</strong>: ${w.new_count ?? 0} new | avg ${formatMinutes(
          w.avg_duration_min
        )} | median ${formatMinutes(
          w.median_duration_min
        )} | hit ${formatPercent(w.hit_rate)} | burst ${formatBurst(
          w.burstiness_ratio
        )}</li>`
      );
    });
    htmlLines.push('</ul>');
  });
  htmlLines.push('<h3>How to read</h3><ul>');
  htmlLines.push('<li>Higher new count = higher short-term demand.</li>');
  htmlLines.push('<li>avg = average availability duration in minutes (last_seen - first_seen).</li>');
  htmlLines.push('<li>med = median availability duration in minutes.</li>');
  htmlLines.push('<li>Shorter med = higher competition.</li>');
  htmlLines.push('<li>Lower hit = queue needs faster checks.</li>');
  htmlLines.push('<li>burst = max hourly new slots / avg hourly new slots.</li>');
  htmlLines.push('</ul>');

  const { data: runRow, error: runErr } = await supabase
    .from('analysis_runs')
    .insert({
      job_type: 'six_hour',
      run_at: windowEndIso,
      window_start: windowStartIso,
      window_end: windowEndIso,
      metrics_json: metrics,
      summary_text: textLines.join('\n'),
      summary_html: htmlLines.join('\n'),
    })
    .select('id')
    .single();
  if (runErr) throw runErr;

  const rollupDate = toHstDateString(now);
  const dayStartUtc = new Date(`${rollupDate}T10:00:00.000Z`);
  const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60 * 1000);

  const rollupSnapshots = await fetchAll(
    'day_snapshots',
    'location_id,captured_at,date',
    (q) => q.gte('captured_at', dayStartUtc.toISOString()).lt('captured_at', dayEndUtc.toISOString())
  );

  const rollupSlotStates = await fetchAll(
    'slot_states',
    'location_id,date,time,first_seen,last_seen',
    (q) => q.gte('first_seen', dayStartUtc.toISOString()).lt('first_seen', dayEndUtc.toISOString())
  );

  const rollupByLocation = {};
  for (const loc of locations || []) {
    const windowStats = {};
    WINDOWS.forEach((days) => {
      windowStats[days] = initWindowStats();
    });
    const exclusiveStats = {};
    EXCLUSIVE_BUCKETS.forEach((bucket) => {
      exclusiveStats[bucket.key] = initWindowStats();
    });
    rollupByLocation[loc.id] = {
      location_id: loc.id,
      rollup_date: rollupDate,
      leadDays: [],
      snapshots_count: 0,
      slots_total: 0,
      slotsDistinctSet: new Set(),
      windowStats,
      exclusiveStats,
    };
  }

  for (const snap of rollupSnapshots || []) {
    const loc = rollupByLocation[snap.location_id];
    if (!loc) continue;
    const capturedDate = toHstDateString(new Date(snap.captured_at));
    const lead = diffDays(capturedDate, snap.date);
    if (lead == null) continue;
    loc.snapshots_count += 1;
    loc.leadDays.push(lead);
    WINDOWS.forEach((days) => {
      if (lead <= days) loc.windowStats[days].hitCount += 1;
    });
    const exclusiveKey = getExclusiveKey(lead);
    if (exclusiveKey) loc.exclusiveStats[exclusiveKey].hitCount += 1;
  }

  for (const entry of rollupSlotStates || []) {
    if (!entry || !entry.location_id || !entry.first_seen) continue;
    const loc = rollupByLocation[entry.location_id];
    if (!loc) continue;
    loc.slots_total += 1;
    loc.slotsDistinctSet.add(`${entry.date} ${entry.time}`);
    const firstSeen = new Date(entry.first_seen);
    const capturedDate = toHstDateString(firstSeen);
    const lead = diffDays(capturedDate, entry.date);
    if (lead == null) continue;
    const lastSeen = entry.last_seen ? new Date(entry.last_seen) : firstSeen;
    const durationMin = Math.max(0, (lastSeen - firstSeen) / (60 * 1000));
    const hour = toHstHour(firstSeen);
    WINDOWS.forEach((days) => {
      if (lead <= days) {
        const stats = loc.windowStats[days];
        stats.newCount += 1;
        stats.durationsMin.push(durationMin);
        stats.hourBuckets[hour] += 1;
      }
    });
    const exclusiveKey = getExclusiveKey(lead);
    if (exclusiveKey) {
      const stats = loc.exclusiveStats[exclusiveKey];
      stats.newCount += 1;
      stats.durationsMin.push(durationMin);
      stats.hourBuckets[hour] += 1;
    }
  }

  const rollupRows = Object.values(rollupByLocation).map((loc) => {
    const slotsDistinct = loc.slotsDistinctSet.size;
    const turnoverRatio = loc.slots_total
      ? Number((slotsDistinct / loc.slots_total).toFixed(4))
      : null;
    const windowsJson = {};
    WINDOWS.forEach((days) => {
      const stats = loc.windowStats[days];
      const avgDuration = average(stats.durationsMin);
      const medianDuration = percentile(stats.durationsMin, 0.5);
      const hitRate = loc.snapshots_count
        ? Number((stats.hitCount / loc.snapshots_count).toFixed(4))
        : null;
      const maxHour = Math.max(...stats.hourBuckets);
      const avgHour = stats.newCount ? stats.newCount / 24 : 0;
      const burstiness = avgHour
        ? Number((maxHour / avgHour).toFixed(2))
        : null;
      windowsJson[String(days)] = {
        new_count: stats.newCount,
        avg_duration_min: avgDuration,
        median_duration_min: medianDuration,
        hit_rate: hitRate,
        burstiness_ratio: burstiness,
      };
    });
    const exclusiveWindowsJson = {};
    EXCLUSIVE_BUCKETS.forEach((bucket) => {
      const stats = loc.exclusiveStats[bucket.key];
      const avgDuration = average(stats.durationsMin);
      const medianDuration = percentile(stats.durationsMin, 0.5);
      const hitRate = loc.snapshots_count
        ? Number((stats.hitCount / loc.snapshots_count).toFixed(4))
        : null;
      const maxHour = Math.max(...stats.hourBuckets);
      const avgHour = stats.newCount ? stats.newCount / 24 : 0;
      const burstiness = avgHour
        ? Number((maxHour / avgHour).toFixed(2))
        : null;
      exclusiveWindowsJson[bucket.key] = {
        new_count: stats.newCount,
        avg_duration_min: avgDuration,
        median_duration_min: medianDuration,
        hit_rate: hitRate,
        burstiness_ratio: burstiness,
      };
    });
    const within7 = windowsJson['7'] || {};
    return {
      rollup_date: loc.rollup_date,
      location_id: loc.location_id,
      snapshots_count: loc.snapshots_count,
      same_week_rate: within7.hit_rate ?? null,
      lead_days_p10: percentile(loc.leadDays, 0.1),
      lead_days_p50: percentile(loc.leadDays, 0.5),
      lead_days_p90: percentile(loc.leadDays, 0.9),
      slots_total: loc.slots_total,
      slots_distinct: slotsDistinct,
      slot_turnover_ratio: turnoverRatio,
      within_7_new_count: within7.new_count || 0,
      within_7_avg_duration_min: within7.avg_duration_min ?? null,
      within_7_median_duration_min: within7.median_duration_min ?? null,
      hit_rate: within7.hit_rate ?? null,
      burstiness_ratio: within7.burstiness_ratio ?? null,
      within_windows_json: windowsJson,
      exclusive_windows_json: exclusiveWindowsJson,
      updated_at: windowEndIso,
    };
  });

  const rollupPayload = rollupRows;
  let rollupErr = null;
  const rollupAttempt = await supabase
    .from('analysis_rollups_daily')
    .upsert(rollupPayload, { onConflict: 'rollup_date,location_id' });
  rollupErr = rollupAttempt.error;
  if (rollupErr && String(rollupErr.message || '').includes('exclusive_windows_json')) {
    const fallbackRows = rollupRows.map(({ exclusive_windows_json, ...rest }) => rest);
    const fallback = await supabase
      .from('analysis_rollups_daily')
      .upsert(fallbackRows, { onConflict: 'rollup_date,location_id' });
    rollupErr = fallback.error;
  }
  if (rollupErr) throw rollupErr;

  const outFile = process.env.GITHUB_OUTPUT;
  if (outFile) {
    const fs = require('fs');
    fs.appendFileSync(outFile, `analysis_run_id=${runRow.id}\n`);
    fs.appendFileSync(outFile, `job_type=six_hour\n`);
  }

  console.log(`6-hour analysis complete. run_id=${runRow.id}`);
}

main().catch((err) => {
  console.error('6-hour analysis failed:', err.message || err);
  process.exit(1);
});
