const { test, expect } = require('@playwright/test');

/**
 * Booking Bot Test - Test navigation and form filling
 * This test navigates through the DMV site and fills the form but STOPS before submitting.
 */

const START_URL = 'https://alohaq.honolulu.gov/';

// Test user info
const TEST_USER = {
  firstName: 'David',
  lastName: 'Cito',
  phone: '8083426751', // Try plain digits
  email: 'test@example.com', // Placeholder if needed
};

// Pick which location to test
const TEST_LOCATION = 'Downtown Satellite City Hall';

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

test('Booking Bot - Navigate and fill form (NO SUBMIT)', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await enableRequestBlocking(page);

  console.log('\n=== BOOKING BOT TEST ===');
  console.log(`Location: ${TEST_LOCATION}`);
  console.log(`User: ${TEST_USER.firstName} ${TEST_USER.lastName}`);
  console.log(`Phone: ${TEST_USER.phone}`);
  console.log('========================\n');

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

  // 5. Select location
  console.log(`[5] Selecting location: ${TEST_LOCATION}...`);
  const gear = page.locator('.fa-cog, .fa-gear').first();
  const locationTile = page
    .locator('.location.button-look.next')
    .filter({ hasText: TEST_LOCATION })
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

  // 9. Click first available day
  console.log('[9] Clicking first available day...');
  const dayLink = datepicker
    .locator('td[data-handler="selectDay"] a.ui-state-default')
    .first();

  if (!(await dayLink.count())) {
    console.log('ERROR: No available days found!');
    await context.close();
    return;
  }

  const firstDay = await dayLink.evaluate((el) => {
    const td = el.closest('td');
    return {
      day: (el.textContent || '').trim(),
      month: td ? td.getAttribute('data-month') : '',
      year: td ? td.getAttribute('data-year') : '',
    };
  });

  const dayNum = String(firstDay.day || '').padStart(2, '0');
  const monthNum = String(Number(firstDay.month || 0) + 1).padStart(2, '0');
  const dateStr = `${firstDay.year}-${monthNum}-${dayNum}`;
  console.log(`   Selected date: ${dateStr}`);

  await dayLink.click();

  // 10. Wait for time slots
  console.log('[10] Waiting for time slots...');
  await page.locator('.time_wrap .time[data-val]').first().waitFor({
    state: 'visible',
    timeout: 60_000,
  });
  await gear.waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});

  // 11. Get available time slots
  const slots = await page.$$eval('.time_wrap .time[data-val]', (els) =>
    els.map((el) => ({
      dataVal: el.getAttribute('data-val') || '',
      text: (el.textContent || '').trim(),
    }))
  );

  console.log(`   Found ${slots.length} time slots:`);
  slots.slice(0, 5).forEach((s, i) => {
    console.log(`   ${i + 1}. ${s.text || s.dataVal}`);
  });
  if (slots.length > 5) {
    console.log(`   ... and ${slots.length - 5} more`);
  }

  // 12. Click first time slot
  console.log('[11] Clicking first time slot...');
  const firstSlot = page.locator('.time_wrap .time[data-val]').first();
  await firstSlot.click();

  const selectedTime = slots[0]?.text || slots[0]?.dataVal || 'Unknown';
  console.log(`   Selected time: ${selectedTime}`);

  // 13. Wait for form to appear
  console.log('[12] Waiting for booking form...');
  await page.waitForTimeout(3000); // Give form time to load

  // Debug: See what's on the page now
  console.log('   Current URL:', page.url());

  // Look for any visible input fields
  const allInputs = await page.$$eval('input[type="text"]:visible, input:visible', (els) =>
    els.map((el) => ({
      id: el.id,
      name: el.name,
      placeholder: el.placeholder,
      type: el.type,
      visible: el.offsetParent !== null,
    })).filter(e => e.visible || e.id || e.name)
  );
  console.log('   Visible inputs:', JSON.stringify(allInputs.slice(0, 10), null, 2));

  // 14. Fill form fields
  console.log('[13] Filling form with user info...');

  // Wait for the form to be visible
  const form = page.locator('#user_sign_up_form');
  await form.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {
    console.log('   Form not found, continuing anyway...');
  });

  // DMV form validates each field and shows checkmark when valid
  // Icons change from fa-asterisk to fa-check-circle when validated
  // Try typing character by character and using Tab to move between fields

  // Fill first name - click, type, then Tab to next field
  console.log('   Filling #fname...');
  await page.locator('#fname').click();
  await page.keyboard.type(TEST_USER.firstName, { delay: 50 });
  await page.keyboard.press('Tab'); // Move to next field
  await page.waitForTimeout(500);
  const fnameValid = await page.locator('#fnameIcon.fa-check-circle').count() > 0;
  console.log(`   First name: ${TEST_USER.firstName} (valid: ${fnameValid})`);

  // Fill last name - type and Tab
  console.log('   Filling #lname...');
  await page.keyboard.type(TEST_USER.lastName, { delay: 50 });
  await page.keyboard.press('Tab'); // Move to phone field
  await page.waitForTimeout(500);
  const lnameValid = await page.locator('#lnameIcon.fa-check-circle').count() > 0;
  console.log(`   Last name: ${TEST_USER.lastName} (valid: ${lnameValid})`);

  // Fill phone - type digits
  console.log('   Filling phone...');
  await page.keyboard.type(TEST_USER.phone, { delay: 50 });
  await page.keyboard.press('Tab'); // Move out of field to trigger validation
  await page.waitForTimeout(1000);
  const numberValid = await page.locator('#numberIcon.fa-check-circle').count() > 0;
  console.log(`   Phone: ${TEST_USER.phone} (valid: ${numberValid})`);

  // Check validation status
  console.log('   Checking all validation icons...');
  const allValid = fnameValid && lnameValid && numberValid;
  console.log(`   All fields valid: ${allValid}`);

  // Wait for submit button
  await page.waitForTimeout(1000);

  // 15. Take screenshot of filled form
  console.log('[14] Taking screenshot of filled form...');
  const screenshotPath = `screenshots/booking-test-${Date.now()}.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`   Screenshot saved: ${screenshotPath}`);

  // 16. Find submit button but DON'T click it
  console.log('[15] Looking for submit button (NOT clicking)...');
  // DMV form uses a div with class "submit button-look"
  const submitSelectors = ['.submit.button-look', 'div.submit', 'button[type="submit"]', 'input[type="submit"]', '#submitBtn'];

  for (const selector of submitSelectors) {
    const btn = page.locator(selector).first();
    if (await btn.count()) {
      const isVisible = await btn.isVisible().catch(() => false);
      const btnText = await btn.textContent().catch(() => 'Submit');
      console.log(`   Found submit element: "${btnText?.trim()}" (${selector}) visible=${isVisible}`);
      if (isVisible) {
        console.log('\n*** STOPPING HERE - NOT SUBMITTING ***');
        break;
      }
    }
  }

  // 17. Pause for manual inspection (headed mode only)
  console.log('\n=== TEST COMPLETE ===');
  console.log(`Date: ${dateStr}`);
  console.log(`Time: ${selectedTime}`);
  console.log(`User: ${TEST_USER.firstName} ${TEST_USER.lastName}`);
  console.log(`Phone: ${TEST_USER.phone}`);
  console.log('=====================\n');

  // Keep browser open for 10 seconds to inspect (only in headed mode)
  if (!process.env.CI) {
    console.log('Browser will stay open for 10 seconds for inspection...');
    await page.waitForTimeout(10_000);
  }

  await context.close();
});
