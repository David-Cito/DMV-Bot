// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './tests',
  // Increase per-test timeout so the bot has enough time in CI even without slowMo.
  timeout: 180_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'html',
  use: {
    // baseURL: 'http://127.0.0.1:3000',
    actionTimeout: 60_000,
    navigationTimeout: 90_000,
    // Only slow down locally; CI runs headless & fast.
    launchOptions: process.env.CI
      ? { headless: true }
      : { slowMo: 750 },
    trace: process.env.CI ? 'on-first-retry' : 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://127.0.0.1:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
