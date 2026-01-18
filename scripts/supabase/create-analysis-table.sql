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

create table if not exists notification_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  locations text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists notification_subscribers_active_idx
  on notification_subscribers (active);

create table if not exists notification_state (
  subscriber_id uuid not null references notification_subscribers(id) on delete cascade,
  location_name text not null,
  last_data_val text,
  last_notified_at timestamptz,
  primary key (subscriber_id, location_name)
);

create table if not exists slot_states (
  location_id uuid not null references locations(id),
  date date not null,
  time text not null,
  first_seen timestamptz not null,
  last_seen timestamptz not null,
  primary key (location_id, date, time)
);

create index if not exists slot_states_first_seen_idx
  on slot_states (first_seen);

create index if not exists slot_states_last_seen_idx
  on slot_states (last_seen);

create table if not exists run_slot_counts (
  run_at timestamptz not null,
  location_id uuid not null references locations(id),
  slots_total integer not null default 0,
  primary key (run_at, location_id)
);

create index if not exists run_slot_counts_location_idx
  on run_slot_counts (location_id, run_at desc);

create or replace function upsert_slot_states(rows jsonb)
returns void
language plpgsql
as $$
begin
  insert into slot_states (location_id, date, time, first_seen, last_seen)
  select location_id, date, time, first_seen, last_seen
  from jsonb_to_recordset(rows)
    as x(location_id uuid, date date, time text, first_seen timestamptz, last_seen timestamptz)
  on conflict (location_id, date, time)
  do update set
    last_seen = excluded.last_seen,
    first_seen = least(slot_states.first_seen, excluded.first_seen);
end;
$$;
