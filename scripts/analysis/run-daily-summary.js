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
const WINDOWS = [1, 3, 7, 14, 30];

function toHstDateString(date) {
  const hst = new Date(date.getTime() + HST_OFFSET_MS);
  return hst.toISOString().slice(0, 10);
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

async function main() {
  const now = new Date();
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sinceDate = toHstDateString(since);

  const { data: locations, error: locErr } = await supabase
    .from('locations')
    .select('id,name');
  if (locErr) throw locErr;

  const locationsById = new Map(
    (locations || []).map((l) => [l.id, l.name])
  );

  const { data: rollups, error: rollupErr } = await supabase
    .from('analysis_rollups_daily')
    .select('*')
    .gte('rollup_date', sinceDate);
  if (rollupErr) throw rollupErr;

  if (!rollups || !rollups.length) {
    console.log('No rollups found for daily summary.');
    process.exit(0);
  }

  const perLocation = {};
  for (const row of rollups) {
    if (!perLocation[row.location_id]) {
      const windowAgg = {};
      WINDOWS.forEach((days) => {
        windowAgg[days] = {
          days: new Set(),
          newTotal: 0,
          durationSum: 0,
          medianSum: 0,
          durationWeight: 0,
          snapshotsCount: 0,
          hitSum: 0,
          burstSum: 0,
          burstCount: 0,
        };
      });
      perLocation[row.location_id] = {
        windows: windowAgg,
      };
    }
    const loc = perLocation[row.location_id];
    const windowsJson = row.within_windows_json || {};
    WINDOWS.forEach((days) => {
      const key = String(days);
      const w = windowsJson[key] || {};
      const agg = loc.windows[days];
      agg.days.add(row.rollup_date);
      const newCount = w.new_count || 0;
      agg.newTotal += newCount;
      if (w.avg_duration_min != null && newCount) {
        agg.durationSum += w.avg_duration_min * newCount;
        agg.durationWeight += newCount;
      }
      if (w.median_duration_min != null && newCount) {
        agg.medianSum += w.median_duration_min * newCount;
      }
      if (w.hit_rate != null && row.snapshots_count) {
        agg.hitSum += w.hit_rate * row.snapshots_count;
        agg.snapshotsCount += row.snapshots_count;
      } else {
        agg.snapshotsCount += row.snapshots_count || 0;
      }
      if (w.burstiness_ratio != null) {
        agg.burstSum += w.burstiness_ratio;
        agg.burstCount += 1;
      }
    });
  }

  const formatMinutes = (value) =>
    value == null ? 'n/a' : `${value.toFixed(1)}m`;
  const formatPercent = (value) =>
    value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
  const formatBurst = (value) =>
    value == null ? 'n/a' : `${value.toFixed(1)}x`;

  const perLocationMetrics = Object.entries(perLocation).map(([id, stats]) => {
    const name = locationsById.get(id) || `Location ${id}`;
    const windows = {};
    WINDOWS.forEach((days) => {
      const agg = stats.windows[days];
      const daysCount = agg.days.size || 1;
      const avgNewPerDay = agg.newTotal / daysCount;
      const avgDuration = agg.durationWeight
        ? agg.durationSum / agg.durationWeight
        : null;
      const medianDuration = agg.durationWeight
        ? agg.medianSum / agg.durationWeight
        : null;
      const hitRate = agg.snapshotsCount
        ? agg.hitSum / agg.snapshotsCount
        : null;
      const burstiness = agg.burstCount
        ? agg.burstSum / agg.burstCount
        : null;
      windows[days] = {
        avg_new_per_day: avgNewPerDay,
        avg_duration_min: avgDuration,
        median_duration_min: medianDuration,
        hit_rate: hitRate,
        burstiness_ratio: burstiness,
      };
    });
    return {
      location_id: id,
      location_name: name,
      windows,
    };
  });

  const metrics = {
    window_start: since.toISOString(),
    window_end: now.toISOString(),
    per_location: perLocationMetrics,
  };

  const textLines = [];
  textLines.push('Daily Summary (last 7 days)');
  textLines.push(`Generated: ${formatHst(now)}`);
  WINDOWS.forEach((days) => {
    textLines.push('');
    textLines.push(`Within ${days} day${days === 1 ? '' : 's'}:`);
    perLocationMetrics.forEach((loc) => {
      const w = loc.windows[days];
      textLines.push(
        `${loc.location_name}: avg ${w.avg_new_per_day.toFixed(1)} new/day | avg ${formatMinutes(
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
  textLines.push('- Higher new/day = higher short-term demand.');
  textLines.push('- Shorter median duration = higher competition.');
  textLines.push('- Lower hit rate = queue needs faster checks.');
  textLines.push('- Burst >2x = spiky availability; prioritize peak windows.');

  const htmlLines = [];
  htmlLines.push('<h2>Daily Summary (last 7 days)</h2>');
  htmlLines.push(`<p><strong>Generated:</strong> ${formatHst(now)}</p>`);
  WINDOWS.forEach((days) => {
    htmlLines.push(`<h3>Within ${days} day${days === 1 ? '' : 's'}</h3>`);
    htmlLines.push('<ul>');
    perLocationMetrics.forEach((loc) => {
      const w = loc.windows[days];
      htmlLines.push(
        `<li><strong>${loc.location_name}</strong>: avg ${w.avg_new_per_day.toFixed(1)} new/day | avg ${formatMinutes(
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
  htmlLines.push('<li>Higher new/day = higher short-term demand.</li>');
  htmlLines.push('<li>Shorter median duration = higher competition.</li>');
  htmlLines.push('<li>Lower hit rate = queue needs faster checks.</li>');
  htmlLines.push('<li>Burst &gt; 2x = spiky availability; prioritize peak windows.</li>');
  htmlLines.push('</ul>');

  const { data: runRow, error: runErr } = await supabase
    .from('analysis_runs')
    .insert({
      job_type: 'daily_summary',
      run_at: now.toISOString(),
      metrics_json: metrics,
      summary_text: textLines.join('\n'),
      summary_html: htmlLines.join('\n'),
    })
    .select('id')
    .single();
  if (runErr) throw runErr;

  const outFile = process.env.GITHUB_OUTPUT;
  if (outFile) {
    const fs = require('fs');
    fs.appendFileSync(outFile, `analysis_run_id=${runRow.id}\n`);
    fs.appendFileSync(outFile, `job_type=daily_summary\n`);
  }

  console.log(`Daily summary complete. run_id=${runRow.id}`);
}

main().catch((err) => {
  console.error('Daily summary failed:', err.message || err);
  process.exit(1);
});
