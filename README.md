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

## Project Structure

```
.
├── tests/
│   └── example.spec.js    # Sample test file
├── playwright.config.js   # Playwright configuration
├── package.json           # Project dependencies
└── README.md             # This file
```

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
