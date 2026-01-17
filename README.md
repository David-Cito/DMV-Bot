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

This repo is triggered externally via cron-job.org. GitHub Actions cron is disabled; use `workflow_dispatch` or your external scheduler.

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
- `scripts/analyze-history.js` - Generic history patterns report.
- `scripts/analyze-history-booking.js` - Booking-oriented insights report.
- `scripts/analyze-7day-availability.js` - 7-day availability analysis.
- `data/history/dmv-history.json` - Earliest-appointment change log per location + overall (cleared after upload).
- `data/history/dmv-month-history-*.json` - Monthly availability snapshots per location.
- `data/history/reports/` - Generated analysis reports (latest + run logs).
- `data/results/dmv-results.json` - Latest run output for notifications.
- `data/results/dmv-run-buffer.json` - Per-run aggregation buffer for parallel workers.
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
