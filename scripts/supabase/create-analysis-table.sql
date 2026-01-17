create table if not exists analysis_runs (
  id bigserial primary key,
  job_type text not null,
  run_at timestamptz not null default now(),
  window_start timestamptz,
  window_end timestamptz,
  metrics_json jsonb,
  summary_text text,
  summary_html text
);

create index if not exists analysis_runs_job_time_idx
  on analysis_runs (job_type, run_at desc);

create table if not exists analysis_rollups_daily (
  rollup_date date not null,
  location_id uuid not null references locations(id),
  snapshots_count integer not null default 0,
  same_week_rate numeric,
  lead_days_p10 numeric,
  lead_days_p50 numeric,
  lead_days_p90 numeric,
  slots_total integer not null default 0,
  slots_distinct integer not null default 0,
  slot_turnover_ratio numeric,
  within_7_new_count integer not null default 0,
  within_7_avg_duration_min numeric,
  within_7_median_duration_min numeric,
  hit_rate numeric,
  burstiness_ratio numeric,
  within_windows_json jsonb,
  updated_at timestamptz not null default now(),
  primary key (rollup_date, location_id)
);

create index if not exists analysis_rollups_daily_date_idx
  on analysis_rollups_daily (rollup_date);

create index if not exists analysis_rollups_daily_location_idx
  on analysis_rollups_daily (location_id, rollup_date);
