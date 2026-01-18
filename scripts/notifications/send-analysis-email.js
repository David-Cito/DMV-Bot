#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANALYSIS_RUN_ID = process.env.ANALYSIS_RUN_ID;
const JOB_TYPE = process.env.JOB_TYPE;

const CHART_WINDOWS = [1, 3, 7, 14, 30, 60];
const HST_TIMEZONE = 'Pacific/Honolulu';
const CHART_COLORS = {
  background: '#0B0F14',
  panel: '#111827',
  grid: '#1F2937',
  text: '#E5E7EB',
  muted: '#9CA3AF',
  accent: '#3ECF8E',
};

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Supabase env vars not set; exiting.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function formatHst(date) {
  return date.toLocaleString('en-US', {
    timeZone: HST_TIMEZONE,
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
}

function formatHstShort(date) {
  return date.toLocaleString('en-US', {
    timeZone: HST_TIMEZONE,
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

async function fetchAll(queryBuilder) {
  const pageSize = 1000;
  let from = 0;
  const out = [];
  while (true) {
    const { data, error } = await queryBuilder.range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    out.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

function buildSeriesDatasets(seriesByWindow) {
  const dashPatterns = [[], [6, 4], [2, 4], [8, 4], [4, 2], [1, 2]];
  return CHART_WINDOWS.map((days, idx) => ({
    label: `${days}d`,
    data: seriesByWindow.get(days) || [],
    borderColor: CHART_COLORS.accent,
    backgroundColor: 'rgba(62, 207, 142, 0.12)',
    pointRadius: 2,
    borderWidth: 2,
    borderDash: dashPatterns[idx % dashPatterns.length],
    tension: 0.25,
  }));
}

function quickChartUrl(config, width = 820, height = 360) {
  const encoded = encodeURIComponent(JSON.stringify(config));
  return `https://quickchart.io/chart?c=${encoded}&w=${width}&h=${height}&bkg=${encodeURIComponent(
    CHART_COLORS.background
  )}`;
}

function buildLineChartConfig({ title, labels, datasets, yLabel }) {
  return {
    type: 'line',
    data: {
      labels,
      datasets,
    },
    options: {
      plugins: {
        legend: {
          labels: { color: CHART_COLORS.text },
        },
        title: {
          display: true,
          text: title,
          color: CHART_COLORS.text,
        },
      },
      scales: {
        x: {
          ticks: { color: CHART_COLORS.muted },
          grid: { color: CHART_COLORS.grid },
        },
        y: {
          ticks: { color: CHART_COLORS.muted },
          grid: { color: CHART_COLORS.grid },
          title: {
            display: !!yLabel,
            text: yLabel,
            color: CHART_COLORS.muted,
          },
        },
      },
    },
  };
}

function buildBarChartConfig({ title, labels, data, yLabel }) {
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: title,
          data,
          backgroundColor: CHART_COLORS.accent,
          borderColor: CHART_COLORS.accent,
        },
      ],
    },
    options: {
      plugins: {
        legend: {
          labels: { color: CHART_COLORS.text },
        },
        title: {
          display: true,
          text: title,
          color: CHART_COLORS.text,
        },
      },
      scales: {
        x: {
          ticks: { color: CHART_COLORS.muted },
          grid: { color: CHART_COLORS.grid },
        },
        y: {
          ticks: { color: CHART_COLORS.muted },
          grid: { color: CHART_COLORS.grid },
          title: {
            display: !!yLabel,
            text: yLabel,
            color: CHART_COLORS.muted,
          },
        },
      },
    },
  };
}

function wrapDarkEmailHtml(content) {
  return `
  <div style="background:${CHART_COLORS.background};color:${CHART_COLORS.text};padding:24px;font-family:Arial, sans-serif;">
    <div style="max-width:900px;margin:0 auto;background:${CHART_COLORS.panel};padding:20px;border-radius:8px;">
      ${content}
    </div>
  </div>
  `;
}

async function buildChartsHtml() {
  const now = new Date();
  const sixHourStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const dailyStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const sixHourRows = await fetchAll(
    supabase
      .from('analysis_windows')
      .select('run_at,window_days,hit_rate')
      .eq('job_type', 'six_hour')
      .gte('run_at', sixHourStart.toISOString())
      .order('run_at', { ascending: true })
  );

  const dailyRows = await fetchAll(
    supabase
      .from('analysis_windows')
      .select('run_at,window_days,median_duration_min')
      .eq('job_type', 'daily_summary')
      .gte('run_at', dailyStart.toISOString())
      .order('run_at', { ascending: true })
  );

  const { data: latestSix, error: latestErr } = await supabase
    .from('analysis_windows')
    .select('run_at')
    .eq('job_type', 'six_hour')
    .order('run_at', { ascending: false })
    .limit(1);
  if (latestErr) throw latestErr;

  let latestRows = [];
  if (latestSix && latestSix.length) {
    latestRows = await fetchAll(
      supabase
        .from('analysis_windows')
        .select('run_at,window_days,new_count')
        .eq('job_type', 'six_hour')
        .eq('run_at', latestSix[0].run_at)
        .order('window_days', { ascending: true })
    );
  }

  const hitRateByKey = new Map();
  for (const row of sixHourRows) {
    const key = `${row.run_at}|${row.window_days}`;
    const existing = hitRateByKey.get(key) || { sum: 0, count: 0 };
    existing.sum += row.hit_rate || 0;
    existing.count += 1;
    hitRateByKey.set(key, existing);
  }

  const hitRateByRun = new Map();
  for (const [key, agg] of hitRateByKey.entries()) {
    const [runAt, windowDays] = key.split('|');
    if (!hitRateByRun.has(runAt)) hitRateByRun.set(runAt, new Map());
    hitRateByRun.get(runAt).set(Number(windowDays), agg.count ? agg.sum / agg.count : 0);
  }

  const hitLabels = Array.from(hitRateByRun.keys())
    .sort()
    .map((iso) => formatHstShort(new Date(iso)));
  const hitSeriesByWindow = new Map();
  for (const days of CHART_WINDOWS) hitSeriesByWindow.set(days, []);
  Array.from(hitRateByRun.keys())
    .sort()
    .forEach((iso) => {
      const windowMap = hitRateByRun.get(iso) || new Map();
      CHART_WINDOWS.forEach((days) => {
        hitSeriesByWindow.get(days).push(windowMap.get(days) ?? null);
      });
    });

  const medByKey = new Map();
  for (const row of dailyRows) {
    const key = `${row.run_at}|${row.window_days}`;
    const existing = medByKey.get(key) || { sum: 0, count: 0 };
    if (row.median_duration_min != null) {
      existing.sum += row.median_duration_min;
      existing.count += 1;
      medByKey.set(key, existing);
    }
  }
  const medByRun = new Map();
  for (const [key, agg] of medByKey.entries()) {
    const [runAt, windowDays] = key.split('|');
    if (!medByRun.has(runAt)) medByRun.set(runAt, new Map());
    medByRun.get(runAt).set(
      Number(windowDays),
      agg.count ? Number((agg.sum / agg.count).toFixed(2)) : null
    );
  }

  const medLabels = Array.from(medByRun.keys())
    .sort()
    .map((iso) => formatHstShort(new Date(iso)));
  const medSeriesByWindow = new Map();
  for (const days of CHART_WINDOWS) medSeriesByWindow.set(days, []);
  Array.from(medByRun.keys())
    .sort()
    .forEach((iso) => {
      const windowMap = medByRun.get(iso) || new Map();
      CHART_WINDOWS.forEach((days) => {
        medSeriesByWindow.get(days).push(windowMap.get(days) ?? null);
      });
    });

  const latestByWindow = new Map();
  for (const row of latestRows) {
    const existing = latestByWindow.get(row.window_days) || 0;
    latestByWindow.set(row.window_days, existing + (row.new_count || 0));
  }
  const barLabels = CHART_WINDOWS.map((days) => `${days}d`);
  const barData = CHART_WINDOWS.map((days) => latestByWindow.get(days) || 0);

  const hitConfig = buildLineChartConfig({
    title: 'Hit Rate Over Time (6-hour)',
    labels: hitLabels,
    datasets: buildSeriesDatasets(hitSeriesByWindow),
    yLabel: 'Hit rate',
  });
  const barConfig = buildBarChartConfig({
    title: 'New Slots vs Window (latest 6-hour)',
    labels: barLabels,
    data: barData,
    yLabel: 'New slots',
  });
  const medConfig = buildLineChartConfig({
    title: 'Median Duration Over Time (daily)',
    labels: medLabels,
    datasets: buildSeriesDatasets(medSeriesByWindow),
    yLabel: 'Minutes',
  });

  const hitUrl = quickChartUrl(hitConfig);
  const barUrl = quickChartUrl(barConfig, 820, 320);
  const medUrl = quickChartUrl(medConfig);

  return `
    <h2 style="margin-top:0;">Charts</h2>
    <p style="color:${CHART_COLORS.muted};margin-top:0;">
      Supabase-style dark theme. All windows shown in green with dashed variants.
    </p>
    <div style="margin:16px 0;">
      <img src="${hitUrl}" alt="Hit rate over time chart" style="width:100%;border-radius:8px;" />
    </div>
    <div style="margin:16px 0;">
      <img src="${barUrl}" alt="New slots by window chart" style="width:100%;border-radius:8px;" />
    </div>
    <div style="margin:16px 0;">
      <img src="${medUrl}" alt="Median duration over time chart" style="width:100%;border-radius:8px;" />
    </div>
  `;
}

async function fetchRun() {
  if (ANALYSIS_RUN_ID) {
    const { data, error } = await supabase
      .from('analysis_runs')
      .select('*')
      .eq('id', ANALYSIS_RUN_ID)
      .single();
    if (error) throw error;
    return data;
  }

  if (JOB_TYPE) {
    const { data, error } = await supabase
      .from('analysis_runs')
      .select('*')
      .eq('job_type', JOB_TYPE)
      .order('run_at', { ascending: false })
      .limit(1)
      .single();
    if (error) throw error;
    return data;
  }

  throw new Error('ANALYSIS_RUN_ID or JOB_TYPE is required.');
}

async function main() {
  const run = await fetchRun();
  const runAt = run.run_at ? new Date(run.run_at) : new Date();
  const label = run.job_type === 'daily_summary' ? 'Daily Summary' : '6-hour Analysis';
  const subject = `DMV ${label} – ${formatHst(runAt)}`;
  const textBody = run.summary_text || 'No summary text available.';
  const summaryHtml = run.summary_html
    ? run.summary_html
    : `<pre>${textBody.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`;
  const chartsHtml = await buildChartsHtml();
  const htmlBody = wrapDarkEmailHtml(`${chartsHtml}<hr style="border-color:${CHART_COLORS.grid};margin:24px 0;" />${summaryHtml}`);

  const outFile = process.env.GITHUB_OUTPUT;
  if (outFile) {
    const fs = require('fs');
    fs.appendFileSync(outFile, `subject=${subject}\n`);
    fs.appendFileSync(outFile, `text_body<<EOF\n${textBody}\nEOF\n`);
    fs.appendFileSync(outFile, `html_body<<EOF\n${htmlBody}\nEOF\n`);
  }

  console.log(`Prepared email for analysis_run_id=${run.id}`);
}

main().catch((err) => {
  console.error('Failed to prepare analysis email:', err.message || err);
  process.exit(1);
});
