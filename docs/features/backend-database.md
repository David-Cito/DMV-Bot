# Backend + Database

## Summary
The project now uses Supabase (PostgreSQL) as the primary backend data store. The bot writes runs, snapshots, and slot state changes, and the analysis/reporting system reads from those tables to generate rollups and notifications.

## Current Backend + Database

### Core Tracking Tables
- `runs` — one bot run (timestamp + source).
- `day_snapshots` — earliest day + its slots for each location at that run time.
- `slot_states` — unique slots across the month with `first_seen`/`last_seen`.
- `run_slot_counts` — total slots found per location per run (trend line).

### Notification Tables
- `notification_subscribers` — who receives alerts.
- `notification_state` — last slot notified per subscriber/location (dedupe).

### Analysis Tables
- `analysis_runs` — raw analysis outputs (6-hour/daily/weekly).
- `analysis_rollups_daily` — daily summaries per location, with
  `within_windows_json` (inclusive) and `exclusive_windows_json`.

### Views (Charting)
- `analysis_windows` — flattened inclusive windows for charts.
- `analysis_windows_exclusive` — flattened exclusive buckets (0–7, 8–14, 15–30, 31–60).
- `analysis_windows_exclusive_hst` — same as above with `run_at_hst`.

### Local Files (Still Used)
- `data/results/dmv-results.json` — latest run output for notifications.
- `data/history/dmv-history.json` + `data/history/dmv-month-history-*.json` — temporary history files, cleared after Supabase upload.

## Planned / Next Phase

### Backend Responsibilities (Future)
- User management and authentication
- Constraint configuration (location, date window, service type)
- Queue assignment and prioritization
- Notification routing and retries
- Booking workflows (approval + auto-book)
- Pricing and deposit tracking

### Open Questions
- Retention policy for raw slot state data?
- Long-term storage for historical runs?
- Securing PII when user accounts are added?
