#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const RESULTS_DIR = path.join(ROOT, 'data', 'results');
const CHARTS_PATH = path.join(RESULTS_DIR, 'supabase-charts.json');

const charts = [
  {
    name: 'Overall Hit Rate Over Time (by window)',
    query:
      "select run_at, window_days, avg(hit_rate) as hit_rate from public.analysis_windows where job_type = 'six_hour' and run_at >= now() - interval '7 days' group by run_at, window_days order by run_at;",
    type: 'line',
    x: 'run_at',
    y: 'hit_rate',
    series: 'window_days',
  },
  {
    name: 'Overall New Slots vs Window (latest run)',
    query:
      "with latest as (select max(run_at) as run_at from public.analysis_windows where job_type = 'six_hour') select window_days, sum(new_count) as new_count from public.analysis_windows aw join latest l on aw.run_at = l.run_at where aw.job_type = 'six_hour' group by window_days order by window_days;",
    type: 'bar',
    x: 'window_days',
    y: 'new_count',
  },
  {
    name: 'Overall Median Duration Over Time (daily summary)',
    query:
      "select run_at, window_days, avg(median_duration_min) as median_duration_min from public.analysis_windows where job_type = 'daily_summary' and run_at >= now() - interval '30 days' group by run_at, window_days order by run_at;",
    type: 'line',
    x: 'run_at',
    y: 'median_duration_min',
    series: 'window_days',
  },
];

function runNode(scriptPath) {
  const result = spawnSync(process.execPath, [scriptPath], {
    stdio: 'inherit',
    cwd: ROOT,
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function main() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(CHARTS_PATH, JSON.stringify(charts, null, 2), 'utf8');
  console.log(`Wrote ${CHARTS_PATH}`);

  // Keep the suite lightweight: do not run analysis jobs here.
  runNode(path.join('scripts', 'supabase', 'run-health-check.js'));
}

main();
