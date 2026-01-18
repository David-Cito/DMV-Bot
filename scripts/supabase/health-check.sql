-- Supabase backend health check for DMV Bot
-- Run this in Supabase SQL Editor to verify schema + recent data.

-- 1) Tables + columns (public)
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;

-- 2) Views (public)
select table_name as view_name
from information_schema.views
where table_schema = 'public'
order by table_name;

-- 3) Row counts (core tables)
select 'locations' as table_name, count(*) as row_count from public.locations
union all
select 'runs', count(*) from public.runs
union all
select 'day_snapshots', count(*) from public.day_snapshots
union all
select 'slot_states', count(*) from public.slot_states
union all
select 'run_slot_counts', count(*) from public.run_slot_counts
union all
select 'analysis_runs', count(*) from public.analysis_runs
union all
select 'analysis_rollups_daily', count(*) from public.analysis_rollups_daily
union all
select 'notification_subscribers', count(*) from public.notification_subscribers
union all
select 'notification_state', count(*) from public.notification_state;

-- 4) Latest run timestamps (core tables)
select 'day_snapshots' as table_name, max(captured_at) as latest_at
from public.day_snapshots
union all
select 'slot_states', max(last_seen) from public.slot_states
union all
select 'run_slot_counts', max(run_at) from public.run_slot_counts
union all
select 'analysis_runs', max(run_at) from public.analysis_runs;

-- 5) Latest analysis runs
select id, job_type, run_at
from public.analysis_runs
order by run_at desc
limit 10;

-- 6) Single JSON report (easy to copy/paste)
with
  tables as (
    select
      table_name,
      jsonb_agg(
        jsonb_build_object('column_name', column_name, 'data_type', data_type)
        order by ordinal_position
      ) as columns
    from information_schema.columns
    where table_schema = 'public'
    group by table_name
    order by table_name
  ),
  views as (
    select jsonb_agg(table_name order by table_name) as view_names
    from information_schema.views
    where table_schema = 'public'
  ),
  counts as (
    select 'locations' as table_name, count(*) as row_count from public.locations
    union all select 'runs', count(*) from public.runs
    union all select 'day_snapshots', count(*) from public.day_snapshots
    union all select 'slot_states', count(*) from public.slot_states
    union all select 'run_slot_counts', count(*) from public.run_slot_counts
    union all select 'analysis_runs', count(*) from public.analysis_runs
    union all select 'analysis_rollups_daily', count(*) from public.analysis_rollups_daily
    union all select 'notification_subscribers', count(*) from public.notification_subscribers
    union all select 'notification_state', count(*) from public.notification_state
  ),
  latest as (
    select 'day_snapshots' as table_name, max(captured_at) as latest_at
    from public.day_snapshots
    union all
    select 'slot_states', max(last_seen) from public.slot_states
    union all
    select 'run_slot_counts', max(run_at) from public.run_slot_counts
    union all
    select 'analysis_runs', max(run_at) from public.analysis_runs
  ),
  recent_analysis as (
    select jsonb_agg(
      jsonb_build_object('id', id, 'job_type', job_type, 'run_at', run_at)
      order by run_at desc
    ) as rows
    from (
      select id, job_type, run_at
      from public.analysis_runs
      order by run_at desc
      limit 10
    ) r
  )
select jsonb_pretty(
  jsonb_build_object(
    'tables', (select jsonb_agg(jsonb_build_object('table_name', table_name, 'columns', columns)) from tables),
    'views', (select coalesce(view_names, '[]'::jsonb) from views),
    'counts', (select jsonb_agg(jsonb_build_object('table_name', table_name, 'row_count', row_count)) from counts),
    'latest', (select jsonb_agg(jsonb_build_object('table_name', table_name, 'latest_at', latest_at)) from latest),
    'recent_analysis_runs', (select coalesce(rows, '[]'::jsonb) from recent_analysis)
  )
) as report;
