# DMV Appointment Bot

A basic template for Playwright automation testing that loads a website and runs tests.

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn

## Installation

1. Install dependencies:
```bash
npm install
```

2. Install Playwright browsers:
```bash
npx playwright install
```

## Running Tests

- Run all tests:
```bash
npm test
```

- Run tests in headed mode (see the browser):
```bash
npm run test:headed
```

- Run tests in debug mode:
```bash
npm run test:debug
```

- Run tests with UI mode:
```bash
npm run test:ui
```

## Scheduling

The DMV bot run is triggered externally via cron-job.org (GitHub Actions cron disabled for that workflow). Analysis workflows use GitHub Actions schedules.
For every-minute checks, use `dmv-appointment-earliest.yml` (earliest-only mode).

## Analysis Reports

- 6-hour analysis runs in GitHub Actions at 12:00 AM, 6:00 AM, 12:00 PM, 6:00 PM HST (UTC: 10:00, 16:00, 22:00, 04:00).
- Daily summary runs at 7:30 AM HST (UTC: 17:30).
- Results are stored in Supabase:
  - `analysis_runs` for raw snapshots and summaries
  - `analysis_rollups_daily` for daily aggregates

Notifications are fully separated in `.github/workflows/dmv-notifications.yml` and send email using existing SMTP secrets.

## User Notification System (Within 7 Days)

- Subscriber list lives in Supabase table `notification_subscribers` (email + locations).
- `dmv-appointment-earliest.yml` sends emails every minute for earliest appointments within 7 days.
- Deduping is handled in `notification_state` to avoid repeat alerts for the same slot.

## Project Structure

```
.
├── data/
│   ├── history/            # Temporary history (cleared after Supabase upload)
│   └── results/            # Latest run results + run buffer
├── docs/
│   ├── action-map.md       # Browser action reference
│   └── features/           # Feature documentation (current + planned)
├── scripts/                # Analysis scripts
├── tests/
│   └── example.spec.js     # Playwright flow + data capture
├── playwright.config.js    # Playwright configuration
├── package.json            # Project dependencies
└── README.md               # This file
```

## File Map

- `tests/example.spec.js` - Parallel Playwright flow (one test per location).
- `.github/workflows/dmv-appointment-earliest.yml` - Earliest-only checks (fast, every-minute ready).
- `data/history/dmv-history.json` - Earliest-appointment change log per location + overall (cleared after upload).
- `data/history/dmv-month-history-*.json` - Monthly availability snapshots per location.
- `data/results/dmv-results.json` - Latest run output for notifications.
- `data/results/dmv-run-buffer.json` - Per-run aggregation buffer for parallel workers.
- `scripts/analysis/run-6hour-analysis.js` - 6-hour Supabase analysis + rollups.
- `scripts/analysis/run-daily-summary.js` - Daily rollup summary (Supabase).
- `scripts/notifications/send-analysis-email.js` - Notification email builder for analysis runs.
- `docs/action-map.md` - Human-readable action reference for browser steps.
- `docs/features/` - Feature documentation (overview, pricing, queue, notifications, booking, backend).

## Customizing Tests

Edit the test file `tests/example.spec.js` to:
- Change the website URL
- Add your own test cases
- Modify assertions and interactions

## Configuration

Edit `playwright.config.js` to:
- Change test directory
- Configure browsers
- Set up base URLs
- Adjust retry and timeout settings

## Test Reports

After running tests, view the HTML report:
```bash
npx playwright show-report
```
