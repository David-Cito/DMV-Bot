const { test, expect } = require('@playwright/test');

/**
 * REAL BOOKING TEST - Hawaii Kai, July 24th 2026, 9:45 AM
 * This will ACTUALLY SUBMIT the booking!
 */

const START_URL = 'https://alohaq.honolulu.gov/';

// Test user info
const TEST_USER = {
  firstName: 'David',
  lastName: 'Cito',
  phone: '8083426751',
};

// Target booking
const TARGET = {
  location: 'Hawaii Kai Satellite City Hall',
  date: '2026-07-24', // July 24th, 2026
  time: '9:45 AM',
  timeDataVal: '09:45', // Format used in data-val attribute
};

async function enableRequestBlocking(page) {
  await page.route('**/*', (route) => {
    const req = route.request();
    const type = req.resourceType();
    const url = req.url();
    if (['image', 'media', 'font'].includes(type)) {
      return route.abort();
    }
    if (/google-analytics|googletagmanager|doubleclick|facebook|segment|hotjar/i.test(url)) {
      return route.abort();
    }
    return route.continue();
  });
}

test('REAL BOOKING - Hawaii Kai July 24 2026 9:45 AM', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await enableRequestBlocking(page);

  console.log('\n========================================');
  console.log('   REAL BOOKING TEST - WILL SUBMIT!');
  console.log('========================================');
  console.log(`Location: ${TARGET.location}`);
  console.log(`Date: ${TARGET.date}`);
  console.log(`Time: ${TARGET.time}`);
  console.log(`User: ${TEST_USER.firstName} ${TEST_USER.lastName}`);
  console.log(`Phone: ${TEST_USER.phone}`);
  console.log('========================================\n');

  // 1. Navigate to start page
  console.log('[1] Navigating to DMV site...');
  await page.goto(START_URL, { waitUntil: 'domcontentloaded' });

  // 2. Click Driver Licensing
  console.log('[2] Clicking Driver Licensing...');
  await page.getByText('Driver Licensing and').click();

  // 3. Click Make Appointment
  console.log('[3] Clicking Make Appointment...');
  const makeApptButton = page.locator('#newAppointment');
  await page.locator('#start').waitFor({ state: 'visible', timeout: 120_000 });
  await makeApptButton.waitFor({ state: 'visible', timeout: 120_000 });
  await makeApptButton.click({ timeout: 15_000 });

  // 4. Wait for locations page
  console.log('[4] Waiting for locations page...');
  const header = page.getByText('Select location to schedule ticket at');
  await header.waitFor({ timeout: 120_000 });

  // 5. Select Hawaii Kai location
  console.log(`[5] Selecting location: ${TARGET.location}...`);
  const gear = page.locator('.fa-cog, .fa-gear').first();
  const locationTile = page
    .locator('.location.button-look.next')
    .filter({ hasText: TARGET.location })
    .first();
  await gear.waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
  await locationTile.waitFor({ state: 'visible', timeout: 30_000 });
  await locationTile.click({ timeout: 10_000 });

  // 6. Select service
  console.log('[6] Selecting service...');
  await page.getByText('DRIVER LICENSE & STATE ID Renewals').waitFor({ timeout: 30_000 });
  await gear.waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
  await page.getByText('DRIVER LICENSE & STATE ID Renewals').click();
  await page.waitForLoadState('domcontentloaded');

  // 7. Acknowledge requirements
  console.log('[7] Acknowledging requirements...');
  const requiredAck = page.getByText('I have ALL the Required');
  await requiredAck.waitFor({ timeout: 30_000 });
  await requiredAck.click();
  await page.waitForLoadState('domcontentloaded');

  // 8. Wait for datepicker
  console.log('[8] Waiting for calendar...');
  const datepicker = page.locator('#datepicker');
  await datepicker.waitFor({ state: 'visible', timeout: 60_000 });

  // 9. Navigate to July 2026
  console.log('[9] Navigating to July 2026...');
  const [targetYear, targetMonth, targetDay] = TARGET.date.split('-').map(Number);
  const targetMonthIndex = targetMonth - 1; // 0-indexed

  let maxIterations = 12;
  while (maxIterations > 0) {
    const currentTitle = await page.$eval('#datepicker .ui-datepicker-title', (el) => {
      const month = el.querySelector('.ui-datepicker-month')?.textContent?.trim() || '';
      const year = el.querySelector('.ui-datepicker-year')?.textContent?.trim() || '';
      return { month, year };
    });

    const currentYear = parseInt(currentTitle.year, 10);
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const currentMonth = monthNames.findIndex(m =>
      m.toLowerCase().startsWith(currentTitle.month.toLowerCase())
    );

    console.log(`   Current: ${currentTitle.month} ${currentTitle.year}, Target: ${monthNames[targetMonthIndex]} ${targetYear}`);

    if (currentYear === targetYear && currentMonth === targetMonthIndex) {
      console.log('   Reached target month!');
      break;
    }

    // Click next to advance
    const nextButton = page.locator('#datepicker .ui-datepicker-next');
    await nextButton.waitFor({ state: 'visible', timeout: 15_000 });
    await nextButton.click();
    await page.waitForTimeout(500);
    maxIterations--;
  }

  if (maxIterations === 0) {
    throw new Error('Could not navigate to July 2026');
  }

  // 10. Click July 24th
  console.log(`[10] Clicking day ${targetDay}...`);
  const dayLocator = page.locator(
    `#datepicker td[data-handler="selectDay"][data-month="${targetMonthIndex}"][data-year="${targetYear}"] a.ui-state-default`
  ).filter({ hasText: new RegExp(`^${targetDay}$`) }).first();

  if (!(await dayLocator.count())) {
    throw new Error(`Day ${targetDay} not available for selection`);
  }
  await dayLocator.click();

  // 11. Wait for time slots
  console.log('[11] Waiting for time slots...');
  await page.locator('.time_wrap .time[data-val]').first().waitFor({
    state: 'visible',
    timeout: 60_000,
  });
  await gear.waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});

  // 12. Find and click 9:45 AM slot
  console.log(`[12] Looking for ${TARGET.time} slot...`);
  const slots = await page.$$eval('.time_wrap .time[data-val]', (els) =>
    els.map((el) => ({
      dataVal: el.getAttribute('data-val') || '',
      text: (el.textContent || '').trim(),
    }))
  );

  console.log(`   Available slots: ${slots.map(s => s.text).join(', ')}`);

  // Find the 9:45 AM slot
  const targetSlot = slots.find(s => s.text === TARGET.time || s.dataVal.includes(TARGET.timeDataVal));
  if (!targetSlot) {
    throw new Error(`${TARGET.time} slot not found! Available: ${slots.map(s => s.text).join(', ')}`);
  }

  console.log(`   Found slot: ${targetSlot.text} (${targetSlot.dataVal})`);
  const timeSlot = page.locator(`.time_wrap .time[data-val="${targetSlot.dataVal}"]`);
  await timeSlot.click();

  // 13. Wait for form
  console.log('[13] Waiting for booking form...');
  await page.waitForTimeout(2000);
  await page.locator('#user_sign_up_form').waitFor({ state: 'visible', timeout: 30_000 });

  // 14. Fill form using keyboard
  console.log('[14] Filling form...');

  // First name
  await page.locator('#fname').click();
  await page.keyboard.type(TEST_USER.firstName, { delay: 50 });
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);
  const fnameValid = await page.locator('#fnameIcon.fa-check-circle').count() > 0;
  console.log(`   First name: ${TEST_USER.firstName} (valid: ${fnameValid})`);

  // Last name
  await page.keyboard.type(TEST_USER.lastName, { delay: 50 });
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);
  const lnameValid = await page.locator('#lnameIcon.fa-check-circle').count() > 0;
  console.log(`   Last name: ${TEST_USER.lastName} (valid: ${lnameValid})`);

  // Phone
  await page.keyboard.type(TEST_USER.phone, { delay: 50 });
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1000);
  const numberValid = await page.locator('#numberIcon.fa-check-circle').count() > 0;
  console.log(`   Phone: ${TEST_USER.phone} (valid: ${numberValid})`);

  // 15. Check all validations passed
  const allValid = fnameValid && lnameValid && numberValid;
  console.log(`[15] All fields valid: ${allValid}`);

  if (!allValid) {
    // Take screenshot before failing
    await page.screenshot({ path: 'screenshots/booking-failed-validation.png', fullPage: true });
    throw new Error('Form validation failed');
  }

  // 16. Wait for submit button to be visible
  console.log('[16] Waiting for submit button...');
  const submitButton = page.locator('.submit.button-look');
  await submitButton.waitFor({ state: 'visible', timeout: 10_000 });
  console.log('   Submit button is visible!');

  // 17. Take screenshot before submit
  console.log('[17] Taking pre-submit screenshot...');
  await page.screenshot({ path: 'screenshots/booking-pre-submit.png', fullPage: true });

  // 18. CLICK SUBMIT!
  console.log('\n*** SUBMITTING BOOKING ***\n');
  await submitButton.click();

  // 19. Wait for confirmation page and verify success
  console.log('[18] Waiting for confirmation...');
  await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });

  // Verify we're on the confirmation page by checking for the success header
  console.log('[19] Verifying booking confirmation...');
  const confirmationHeader = page.locator('#headerSub');

  let bookingConfirmed = false;
  let confirmationText = '';

  try {
    await confirmationHeader.waitFor({ state: 'visible', timeout: 10_000 });
    confirmationText = await confirmationHeader.textContent();
    bookingConfirmed = confirmationText.includes('successfully scheduled');
    console.log(`   Confirmation header found: "${confirmationText}"`);
  } catch (e) {
    console.log('   WARNING: Confirmation header not found');
  }

  // Additional verification - check for ticket number or confirmation details
  const ticketNumber = await page.locator('#ticketNum, .ticket-number, [id*="ticket"]').textContent().catch(() => '');
  if (ticketNumber) {
    console.log(`   Ticket/Confirmation #: ${ticketNumber}`);
  }

  // 20. Take screenshot of result
  console.log('[20] Taking confirmation screenshot...');
  await page.screenshot({ path: 'screenshots/booking-confirmation.png', fullPage: true });

  // Final verification summary
  console.log('\n========================================');
  console.log('   BOOKING VERIFICATION RESULT');
  console.log('========================================');

  if (bookingConfirmed) {
    console.log('VERIFIED: Booking confirmed!');
    console.log(`Message: "${confirmationText}"`);
    if (ticketNumber) {
      console.log(`Ticket #: ${ticketNumber}`);
    }
  } else {
    // Fallback check on page content
    const pageText = await page.textContent('body');
    if (pageText.includes('successfully scheduled') || pageText.includes('Confirmation')) {
      console.log('SUCCESS: Appointment appears to be booked (fallback check)');
    } else if (pageText.includes('error') || pageText.includes('Error') || pageText.includes('failed')) {
      console.log('ERROR: Booking may have failed');
    } else {
      console.log('UNKNOWN: Check screenshots for result');
    }
  }

  console.log('========================================\n');
  console.log('Screenshots saved:');
  console.log('  - screenshots/booking-pre-submit.png');
  console.log('  - screenshots/booking-confirmation.png');

  // Assert that booking was confirmed (will fail test if not)
  expect(bookingConfirmed, 'Booking should be confirmed with success message').toBe(true);

  // Keep browser open briefly to inspect
  await page.waitForTimeout(5000);

  await context.close();
});
