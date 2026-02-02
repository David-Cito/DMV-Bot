// Booking Bot for Queue System V2
// See openspec/specs/booking-flow/spec.md

import { chromium, type Browser, type Page, type BrowserContext } from 'playwright';
import { getSupabaseClient } from '../../packages/db/supabase_client';
import {
  selectUsersForBooking,
  releaseUsersFromBooking,
  transitionState,
  acquireSlotLock,
  releaseSlotLock,
  chargeBookingFee,
  refundBookingFeeByChargeId,
  getQueueEntry,
  getUsersByIds,
  getLocation,
  getLocationByCode,
  sendBookedMessage,
  sendPaymentFailedMessage,
  sendBookingSubmitFailedMessage,
  isCancelWindowEnabled,
  getCancelWindowSeconds,
} from '../../packages/queue';
import type { SelectedUser } from '../../packages/queue';
import { getBotConfig, loadBotConfig } from './bot-config';

// ============================================================================
// CONSTANTS
// ============================================================================

const START_URL = 'https://alohaq.honolulu.gov/';

// ============================================================================
// TYPES
// ============================================================================

interface SlotInfo {
  location_id: string;
  location_code: string;
  slot_date: string;  // YYYY-MM-DD
  slot_time: string;  // HH:MM:SS
}

interface BookingResult {
  success: boolean;
  booked_user_id?: string;
  booked_queue_entry_id?: string;
  booking_id?: string;
  error?: string;
  error_code?: string;
  users_with_payment_issues: string[];
  screenshot_url?: string; // Only set on failures
}

interface UserInfo {
  user_id: string;
  queue_entry_id: string;
  name: string;
  email: string;
  phone: string;
  tier: string;
}

// ============================================================================
// MAIN BOOKING FUNCTION
// ============================================================================

/**
 * Attempt to book a slot for eligible users
 * Uses dual-user strategy: tries primary user, falls back to backup if payment fails
 */
export async function bookSlot(slot: SlotInfo, botId: string): Promise<BookingResult> {
  const supabase = getSupabaseClient();
  const result: BookingResult = {
    success: false,
    users_with_payment_issues: [],
  };

  // 1. Acquire slot lock
  const lockKey = `${slot.location_id}_${slot.slot_date}_${slot.slot_time}`;
  const lockAcquired = await acquireSlotLock(
    slot.location_id,
    slot.slot_date,
    slot.slot_time,
    botId,
    300 // 5 minute TTL
  );

  if (!lockAcquired) {
    result.error = 'Failed to acquire slot lock - another bot may be booking this slot';
    result.error_code = 'lock_failed';
    return result;
  }

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let selectedUsers: SelectedUser[] = [];

  try {
    // 2. Select top 2 eligible users (atomically sets state to BOOKING)
    selectedUsers = await selectUsersForBooking(
      slot.location_id,
      slot.slot_time,
      botId,
      lockKey, // Use lock key as slot ID
      2
    );

    if (selectedUsers.length === 0) {
      result.error = 'No eligible users found for this slot';
      result.error_code = 'no_users';
      return result;
    }

    // Get full user info for selected users (batch fetch - single query)
    const userIds = selectedUsers.map(su => su.user_id);
    const usersMap = await getUsersByIds(userIds);

    const userInfos: UserInfo[] = [];
    for (const su of selectedUsers) {
      const user = usersMap.get(su.user_id);
      if (user) {
        userInfos.push({
          user_id: su.user_id,
          queue_entry_id: su.queue_entry_id,
          name: user.name || 'DMV Customer',
          email: user.email || '',
          phone: user.phone,
          tier: su.tier,
        });
      }
    }

    if (userInfos.length === 0) {
      result.error = 'Failed to load user info';
      result.error_code = 'user_load_failed';
      return result;
    }

    // Get location info
    const location = await getLocation(slot.location_id) || await getLocationByCode(slot.location_code);
    const locationName = location?.name || 'Unknown Location';

    // 3. Launch browser and navigate to booking page
    browser = await chromium.launch({
      headless: process.env.CI === 'true',
      slowMo: process.env.CI === 'true' ? 0 : 500,
    });
    context = await browser.newContext();
    page = await context.newPage();

    // Block unnecessary requests
    await enableRequestBlocking(page);

    // 4. Navigate to DMV and select the slot (with retry on failure)
    let navResult = await navigateToSlot(page, locationName, slot.slot_date, slot.slot_time, false);

    // If first attempt fails, retry with force reload
    if (!navResult.success) {
      console.log(`[BookingBot] First navigation attempt failed: ${navResult.error}`);
      console.log('[BookingBot] Retrying with force reload...');

      // Close and recreate context for clean state
      await page.close().catch(() => {});
      await context.close().catch(() => {});
      context = await browser.newContext();
      page = await context.newPage();
      await enableRequestBlocking(page);

      navResult = await navigateToSlot(page, locationName, slot.slot_date, slot.slot_time, true);
    }

    if (!navResult.success) {
      result.error = navResult.error || 'Failed to navigate to slot';
      result.error_code = 'navigation_failed';

      // Capture failure screenshot
      result.screenshot_url = await captureFailureScreenshot(page, botId, 'navigation_failed', {
        locationCode: slot.location_code,
        slotDate: slot.slot_date,
        slotTime: slot.slot_time,
      }) || undefined;

      // Release users back to active
      await releaseUsersFromBooking(
        userInfos.map(u => u.queue_entry_id),
        'slot_navigation_failed'
      );
      return result;
    }

    // 5. Try to book with each user (primary first, then backup)
    for (let i = 0; i < userInfos.length; i++) {
      const userInfo = userInfos[i];
      const isLastUser = i === userInfos.length - 1;

      console.log(`[BookingBot] Attempting booking for user ${i + 1}/${userInfos.length}: ${userInfo.user_id}`);

      // Fill user info in form
      await fillUserForm(page, userInfo);

      // 6. Charge booking fee (direct charge, not auth hold)
      const chargeResult = await chargeBookingFee(
        userInfo.user_id,
        userInfo.queue_entry_id,
        slot.location_id,
        userInfo.tier as 'priority' | 'flexible',
        lockKey
      );

      if (!chargeResult.success) {
        console.log(`[BookingBot] Payment failed for user ${userInfo.user_id}: ${chargeResult.error}`);

        // Move user to PAYMENT_ISSUE state
        await transitionState(userInfo.queue_entry_id, 'payment_issue', {
          trigger_type: 'bot_action',
          trigger_details: {
            reason: 'booking_payment_failed',
            error: chargeResult.error,
            error_code: chargeResult.error_code,
          },
        });
        result.users_with_payment_issues.push(userInfo.user_id);

        if (!isLastUser) {
          // Clear form and try next user
          await clearUserForm(page);
          continue;
        } else {
          // All users failed payment
          result.error = 'All users failed payment';
          result.error_code = 'all_payments_failed';
          return result;
        }
      }

      // 7. Payment succeeded - submit the form
      console.log(`[BookingBot] Payment succeeded for user ${userInfo.user_id}, submitting form`);

      const submitResult = await submitBookingForm(page);

      if (!submitResult.success) {
        console.log(`[BookingBot] Submit failed for user ${userInfo.user_id}: ${submitResult.error}`);

        // Refund the charge
        const refundResult = await refundBookingFeeByChargeId(
          userInfo.user_id,
          chargeResult.charge_id!,
          userInfo.queue_entry_id,
          'booking_submit_failed'
        );
        console.log(`[BookingBot] Refund result: ${refundResult.success ? 'success' : refundResult.error}`);

        // Move user back to active
        await transitionState(userInfo.queue_entry_id, 'active', {
          trigger_type: 'bot_action',
          trigger_details: {
            reason: 'booking_submit_failed',
            error: submitResult.error,
            refund_issued: refundResult.success,
            refund_id: refundResult.refund_id,
          },
        });

        // Send notification about the technical issue
        await sendBookingSubmitFailedMessage(
          userInfo.user_id,
          userInfo.phone,
          locationName,
          lockKey
        );

        if (!isLastUser) {
          continue;
        } else {
          result.error = 'Submit failed after payment';
          result.error_code = 'submit_failed';
          // Capture failure screenshot
          result.screenshot_url = await captureFailureScreenshot(page, botId, 'submit_failed', {
            locationCode: slot.location_code,
            slotDate: slot.slot_date,
            slotTime: slot.slot_time,
          }) || undefined;
          return result;
        }
      }

      // 8. Booking successful!
      console.log(`[BookingBot] Booking successful for user ${userInfo.user_id}`);

      // Transition to BOOKED state (this creates the booking record)
      await transitionState(userInfo.queue_entry_id, 'booked', {
        trigger_type: 'bot_action',
        trigger_details: {
          slot_date: slot.slot_date,
          slot_time: slot.slot_time,
        },
        appointment_date: slot.slot_date,
        appointment_time: slot.slot_time,
        booking_fee_cents: chargeResult.charge_id ? undefined : 0, // Will be filled by payment service
        stripe_charge_id: chargeResult.charge_id,
      });

      // Send notification
      await sendBookedMessage(
        userInfo.user_id,
        userInfo.phone,
        locationName,
        slot.slot_date,
        slot.slot_time,
        lockKey
      );

      // Release any remaining users back to active
      const remainingUsers = userInfos.slice(i + 1).map(u => u.queue_entry_id);
      if (remainingUsers.length > 0) {
        await releaseUsersFromBooking(remainingUsers, 'primary_user_booked');
      }

      result.success = true;
      result.booked_user_id = userInfo.user_id;
      result.booked_queue_entry_id = userInfo.queue_entry_id;

      // 9. Handle cancel window if enabled
      const cancelEnabled = await isCancelWindowEnabled();
      if (cancelEnabled) {
        const cancelSeconds = await getCancelWindowSeconds();
        console.log(`[BookingBot] Cancel window enabled, waiting ${cancelSeconds}s`);

        // Poll for cancel requests during cancel window
        const cancelResult = await pollForCancelRequest(
          page,
          userInfo.queue_entry_id,
          cancelSeconds
        );

        if (cancelResult.canceled) {
          console.log(`[BookingBot] User requested cancel, processing...`);

          // Refund the booking fee
          if (chargeResult.charge_id) {
            const refundResult = await refundBookingFeeByChargeId(
              userInfo.user_id,
              chargeResult.charge_id,
              userInfo.queue_entry_id,
              'user_cancel_during_window'
            );
            console.log(`[BookingBot] Refund result: ${refundResult.success ? 'success' : refundResult.error}`);
          }

          // Transition to canceled state
          await transitionState(userInfo.queue_entry_id, 'canceled', {
            trigger_type: 'user_action',
            trigger_details: { reason: 'user_cancel_during_window' },
          });

          result.success = false;
          result.error = 'User canceled during cancel window';
          result.error_code = 'user_canceled';
          return result;
        }

        // Cancel window expired without cancel request - confirm
        await transitionState(userInfo.queue_entry_id, 'confirmed', {
          trigger_type: 'system',
          trigger_details: { reason: 'cancel_window_expired' },
        });
      } else {
        // No cancel window - immediately confirm
        await transitionState(userInfo.queue_entry_id, 'confirmed', {
          trigger_type: 'system',
          trigger_details: { reason: 'cancel_window_disabled' },
        });
      }

      // Send notifications to users with payment issues
      for (const failedUserId of result.users_with_payment_issues) {
        const failedUser = userInfos.find(u => u.user_id === failedUserId);
        if (failedUser) {
          await sendPaymentFailedMessage(
            failedUserId,
            failedUser.phone,
            locationName,
            1 // failure number
          );
        }
      }

      return result;
    }

    // Should not reach here
    result.error = 'Unexpected end of booking loop';
    result.error_code = 'unexpected';
    return result;

  } catch (error: any) {
    console.error(`[BookingBot] Error: ${error.message}`);
    result.error = error.message || 'Unknown error';
    result.error_code = 'exception';

    // Capture failure screenshot
    result.screenshot_url = await captureFailureScreenshot(page, botId, 'exception', {
      locationCode: slot.location_code,
      slotDate: slot.slot_date,
      slotTime: slot.slot_time,
    }) || undefined;

    // Release users back to active
    if (selectedUsers.length > 0) {
      await releaseUsersFromBooking(
        selectedUsers.map(u => u.queue_entry_id),
        'booking_exception'
      );
    }

    return result;

  } finally {
    // Cleanup with timeout protection to prevent resource leaks
    const closeWithTimeout = async (resource: any, name: string, timeoutMs: number = 5000) => {
      if (!resource) return;
      try {
        await Promise.race([
          resource.close(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${name} close timeout`)), timeoutMs)
          ),
        ]);
      } catch (e: any) {
        console.error(`[BookingBot] Failed to close ${name}: ${e.message}`);
      }
    };

    await closeWithTimeout(page, 'page');
    await closeWithTimeout(context, 'context');
    await closeWithTimeout(browser, 'browser');

    // Release slot lock
    await releaseSlotLock(slot.location_id, slot.slot_date, slot.slot_time, botId);
  }
}

// ============================================================================
// SCREENSHOT CAPTURE (FAILURES ONLY)
// ============================================================================

const SCREENSHOT_BUCKET = 'booking-screenshots';

/**
 * Capture screenshot and upload to Supabase Storage
 * Only called on failures for debugging
 */
async function captureFailureScreenshot(
  page: Page | null,
  botId: string,
  errorCode: string,
  context: { locationCode?: string; slotDate?: string; slotTime?: string } = {}
): Promise<string | null> {
  if (!page) return null;

  try {
    const supabase = getSupabaseClient();

    // Generate filename: failures/2026-02-01/botrun-abc123_navigation-failed_downtown.png
    const date = new Date().toISOString().split('T')[0];
    const timestamp = Date.now();
    const locationPart = context.locationCode ? `_${context.locationCode}` : '';
    const filename = `failures/${date}/${botId}_${errorCode}${locationPart}_${timestamp}.png`;

    // Capture screenshot as buffer
    const screenshotBuffer = await page.screenshot({ fullPage: true });

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from(SCREENSHOT_BUCKET)
      .upload(filename, screenshotBuffer, {
        contentType: 'image/png',
        upsert: false,
      });

    if (error) {
      console.log(`[BookingBot] Failed to upload screenshot: ${error.message}`);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(SCREENSHOT_BUCKET)
      .getPublicUrl(filename);

    console.log(`[BookingBot] Screenshot saved: ${urlData.publicUrl}`);
    return urlData.publicUrl;

  } catch (error: any) {
    console.log(`[BookingBot] Screenshot capture failed: ${error.message}`);
    return null;
  }
}

// ============================================================================
// RETRY HELPERS
// ============================================================================

// Retry config loaded from bot-config.ts (uses getBotConfig())

/**
 * Retry a function with exponential backoff
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    delayMs?: number;
    onRetry?: (attempt: number, error: Error) => void;
    description?: string;
  } = {}
): Promise<T> {
  const config = getBotConfig();
  const { maxRetries = config.maxRetries, delayMs = config.retryDelayMs, onRetry, description = 'operation' } = options;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      console.log(`[BookingBot] ${description} failed (attempt ${attempt}/${maxRetries}): ${error.message}`);

      if (attempt < maxRetries) {
        const delay = delayMs * attempt; // Exponential backoff
        console.log(`[BookingBot] Retrying in ${delay}ms...`);
        onRetry?.(attempt, error);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error(`${description} failed after ${maxRetries} attempts`);
}

/**
 * Wait for element with retry
 */
async function waitForElementWithRetry(
  page: Page,
  selector: string,
  options: { timeout?: number; state?: 'visible' | 'hidden' | 'attached' } = {}
): Promise<boolean> {
  const config = getBotConfig();
  const { timeout = 30_000, state = 'visible' } = options;

  try {
    await withRetry(
      async () => {
        await page.locator(selector).waitFor({ state, timeout: timeout / config.maxRetries });
      },
      { description: `waiting for ${selector}` }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Click element with retry
 */
async function clickWithRetry(
  page: Page,
  selector: string,
  options: { timeout?: number } = {}
): Promise<void> {
  const config = getBotConfig();
  const { timeout = 10_000 } = options;

  await withRetry(
    async () => {
      const element = page.locator(selector).first();
      await element.waitFor({ state: 'visible', timeout: timeout / config.maxRetries });
      await element.click({ timeout: timeout / config.maxRetries });
    },
    { description: `clicking ${selector}` }
  );
}

// ============================================================================
// NAVIGATION HELPERS
// ============================================================================

async function enableRequestBlocking(page: Page): Promise<void> {
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

async function navigateToSlot(
  page: Page,
  locationName: string,
  slotDate: string,
  slotTime: string,
  forceReload: boolean = false
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!locationName) {
      return { success: false, error: 'Location name is required' };
    }

    // Navigate to start page with retry
    await withRetry(
      async () => {
        await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        if (forceReload) {
          await page.reload({ waitUntil: 'domcontentloaded' });
        }
      },
      { description: 'loading start page' }
    );

    // Click "Driver Licensing" category with retry
    await withRetry(
      async () => {
        await page.getByText('Driver Licensing and').click({ timeout: 10_000 });
      },
      { description: 'clicking Driver Licensing' }
    );

    // Click "Make Appointment" with retry
    await withRetry(
      async () => {
        const makeApptButton = page.locator('#newAppointment');
        await page.locator('#start').waitFor({ state: 'visible', timeout: 30_000 });
        await makeApptButton.waitFor({ state: 'visible', timeout: 30_000 });
        await makeApptButton.click({ timeout: 15_000 });
      },
      { description: 'clicking Make Appointment' }
    );

    // Wait for locations page with retry
    await withRetry(
      async () => {
        const header = page.getByText('Select location to schedule ticket at');
        await header.waitFor({ timeout: 30_000 });
      },
      { description: 'waiting for locations page' }
    );

    // Select location with retry
    const gear = page.locator('.fa-cog, .fa-gear').first();
    await withRetry(
      async () => {
        const locationTile = page
          .locator('.location.button-look.next')
          .filter({ hasText: locationName })
          .first();
        await gear.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
        await locationTile.waitFor({ state: 'visible', timeout: 10_000 });
        await locationTile.click({ timeout: 10_000 });
      },
      { description: `selecting ${locationName}` }
    );

    // Select service with retry
    await withRetry(
      async () => {
        await page.getByText('DRIVER LICENSE & STATE ID Renewals').waitFor({ timeout: 10_000 });
        await gear.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
        await page.getByText('DRIVER LICENSE & STATE ID Renewals').click();
        await page.waitForLoadState('domcontentloaded');
      },
      { description: 'selecting service' }
    );

    // Acknowledge requirements with retry
    await withRetry(
      async () => {
        const requiredAck = page.getByText('I have ALL the Required');
        await requiredAck.waitFor({ timeout: 10_000 });
        await requiredAck.click();
        await page.waitForLoadState('domcontentloaded');
      },
      { description: 'acknowledging requirements' }
    );

    // Wait for datepicker with retry
    await withRetry(
      async () => {
        const datepicker = page.locator('#datepicker');
        await datepicker.waitFor({ state: 'visible', timeout: 20_000 });
      },
      { description: 'waiting for datepicker' }
    );

    // Navigate to the correct month and click the date
    const clickResult = await navigateAndClickDate(page, slotDate, gear);
    if (!clickResult.success) {
      return clickResult;
    }

    // Wait for time slots to load with retry
    await withRetry(
      async () => {
        await page.locator('.time_wrap .time[data-val]').first().waitFor({
          state: 'visible',
          timeout: 20_000,
        });
        await gear.waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => {});
      },
      { description: 'waiting for time slots' }
    );

    // Click the specific time slot
    const timeResult = await clickTimeSlot(page, slotDate, slotTime);
    if (!timeResult.success) {
      return timeResult;
    }

    return { success: true };

  } catch (error: any) {
    return { success: false, error: error.message || 'Navigation failed' };
  }
}

async function navigateAndClickDate(
  page: Page,
  targetDate: string,
  gear: any
): Promise<{ success: boolean; error?: string }> {
  const [yearStr, monthStr, dayStr] = targetDate.split('-');
  const targetYear = parseInt(yearStr, 10);
  const targetMonth = parseInt(monthStr, 10) - 1; // 0-indexed
  const targetDay = parseInt(dayStr, 10);

  // Navigate to correct month
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

    if (currentYear === targetYear && currentMonth === targetMonth) {
      break;
    }

    // Need to navigate forward
    const nextButton = page.locator('#datepicker .ui-datepicker-next');
    await nextButton.waitFor({ state: 'visible', timeout: 15_000 });
    await nextButton.click();

    // Wait for month to change
    await page.waitForTimeout(500);
    maxIterations--;
  }

  if (maxIterations === 0) {
    return { success: false, error: 'Could not navigate to target month' };
  }

  // Click the day
  const dayLocator = page.locator(
    `#datepicker td[data-handler="selectDay"][data-month="${targetMonth}"][data-year="${targetYear}"] a.ui-state-default`
  ).filter({ hasText: new RegExp(`^${targetDay}$`) }).first();

  if (!(await dayLocator.count())) {
    return { success: false, error: `Day ${targetDay} not available for selection` };
  }

  await dayLocator.click();
  return { success: true };
}

async function clickTimeSlot(
  page: Page,
  slotDate: string,
  slotTime: string
): Promise<{ success: boolean; error?: string }> {
  // The time slot data-val format is "YYYY-MM-DD HH:MM:SS"
  const dataVal = `${slotDate} ${slotTime}`;

  const timeSlot = page.locator(`.time_wrap .time[data-val="${dataVal}"]`);

  if (!(await timeSlot.count())) {
    // Try partial match (in case seconds differ)
    const partialDataVal = `${slotDate} ${slotTime.substring(0, 5)}`;
    const partialSlot = page.locator(`.time_wrap .time[data-val^="${partialDataVal}"]`).first();

    if (!(await partialSlot.count())) {
      return { success: false, error: `Time slot ${slotTime} not available` };
    }

    await partialSlot.click();
  } else {
    await timeSlot.click();
  }

  // Wait for form to appear
  await page.waitForSelector('input[name="firstName"], input[name="first_name"], #firstName', {
    timeout: 30_000,
  }).catch(() => {});

  return { success: true };
}

// ============================================================================
// FORM HELPERS
// ============================================================================

async function fillUserForm(page: Page, userInfo: UserInfo): Promise<void> {
  // DMV form fields: #fname, #lname, #number (phone)
  // Form ID: #user_sign_up_form
  // Must use keyboard.type() and Tab to trigger proper validation events

  // Wait for form to be visible
  await page.locator('#user_sign_up_form').waitFor({ state: 'visible', timeout: 30_000 });

  const nameParts = userInfo.name.split(' ');
  const firstName = nameParts[0] || 'Customer';
  const lastName = nameParts.slice(1).join(' ') || 'DMV';

  // First name - click, type, Tab to trigger validation
  await page.locator('#fname').click();
  await page.keyboard.type(firstName, { delay: 30 });
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);

  // Last name - type and Tab (cursor already in field from previous Tab)
  await page.keyboard.type(lastName, { delay: 30 });
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);

  // Phone - type digits only (no formatting)
  const phoneNumber = userInfo.phone.replace(/[^\d]/g, ''); // Strip to digits only
  await page.keyboard.type(phoneNumber, { delay: 30 });
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);

  // Wait for submit button to become visible
  await page.locator('.submit.button-look').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {
    console.log('[BookingBot] Warning: Submit button did not become visible');
  });
}

async function clearUserForm(page: Page): Promise<void> {
  // Clear DMV form fields by selecting all and deleting
  await page.locator('#fname').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');

  await page.locator('#lname').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');

  await page.locator('#user_sign_up_form #number').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
}

// ============================================================================
// CANCEL WINDOW POLLING
// ============================================================================

// Cancel poll interval loaded from bot-config.ts

/**
 * Poll for cancel request during cancel window
 * Checks database for cancel_requested flag on queue entry
 * If found, clicks the cancel button on DMV page
 */
async function pollForCancelRequest(
  page: Page,
  queueEntryId: string,
  cancelWindowSeconds: number
): Promise<{ canceled: boolean; error?: string }> {
  const supabase = getSupabaseClient();
  const config = getBotConfig();
  const pollIntervalMs = config.cancelPollIntervalMs;
  const endTime = Date.now() + (cancelWindowSeconds * 1000);

  console.log(`[BookingBot] Starting cancel window poll for ${cancelWindowSeconds}s`);

  while (Date.now() < endTime) {
    try {
      // Check if user requested cancel
      const entry = await getQueueEntry(queueEntryId);

      if (!entry) {
        console.log(`[BookingBot] Queue entry not found during cancel poll`);
        return { canceled: false, error: 'Queue entry not found' };
      }

      // Check for cancel_requested field (set by SMS webhook when user texts CANCEL)
      const { data: entryData } = await supabase
        .from('queue_entries')
        .select('cancel_requested')
        .eq('id', queueEntryId)
        .single();

      if (entryData?.cancel_requested) {
        console.log(`[BookingBot] Cancel requested by user`);

        // Try to click the cancel button on DMV page
        const cancelResult = await clickCancelButton(page);
        if (!cancelResult.success) {
          console.log(`[BookingBot] Warning: Could not click cancel button: ${cancelResult.error}`);
          // Still proceed with cancel even if button click fails
          // The appointment might already be in a state that can't be canceled on DMV side
        }

        return { canceled: true };
      }

      // Wait before next poll
      await page.waitForTimeout(pollIntervalMs);

    } catch (error: any) {
      console.log(`[BookingBot] Error during cancel poll: ${error.message}`);
      // Continue polling despite errors
      await page.waitForTimeout(pollIntervalMs);
    }
  }

  console.log(`[BookingBot] Cancel window expired, no cancel request received`);
  return { canceled: false };
}

/**
 * Click the cancel button on DMV confirmation page
 * The button may be labeled "Cancel" or similar
 */
async function clickCancelButton(page: Page): Promise<{ success: boolean; error?: string }> {
  try {
    // Look for common cancel button patterns on DMV confirmation page
    const cancelSelectors = [
      'button:has-text("Cancel")',
      'a:has-text("Cancel")',
      '.cancel-button',
      '#cancelButton',
      '[data-action="cancel"]',
    ];

    for (const selector of cancelSelectors) {
      const button = page.locator(selector).first();
      if (await button.isVisible()) {
        await button.click();
        console.log(`[BookingBot] Clicked cancel button: ${selector}`);

        // Wait for cancellation to process
        await page.waitForLoadState('domcontentloaded', { timeout: 10_000 });

        return { success: true };
      }
    }

    return { success: false, error: 'No cancel button found on page' };

  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function submitBookingForm(page: Page): Promise<{ success: boolean; error?: string; confirmationText?: string }> {
  try {
    // DMV uses a div with class "submit button-look" that becomes visible after form is filled
    const submitButton = page.locator('.submit.button-look').first();

    await submitButton.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

    if (!(await submitButton.isVisible())) {
      return { success: false, error: 'Submit button not visible' };
    }

    await submitButton.click();

    // Wait for page to load after submit
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });

    // Verify success by checking for the confirmation header
    // Expected: <h4 id="headerSub">You successfully scheduled the ticket...</h4>
    const confirmationHeader = page.locator('#headerSub');

    try {
      await confirmationHeader.waitFor({ state: 'visible', timeout: 10_000 });
      const confirmationText = await confirmationHeader.textContent();

      if (confirmationText && confirmationText.includes('successfully scheduled')) {
        console.log('[BookingBot] Booking confirmed: ' + confirmationText);
        return { success: true, confirmationText: confirmationText };
      }
    } catch {
      // Header not found, continue with fallback checks
    }

    // Fallback: Check page content for success indicators
    const pageText = await page.textContent('body').catch(() => '') || '';

    if (pageText.includes('successfully scheduled') || pageText.includes('Confirmation')) {
      return { success: true, confirmationText: 'Booking appears successful (fallback check)' };
    }

    // Check for error indicators
    if (pageText.includes('error') || pageText.includes('Error') || pageText.includes('not available')) {
      return { success: false, error: 'Booking failed - error message on page' };
    }

    // No clear indicator - assume failure to be safe
    return { success: false, error: 'Could not verify booking confirmation' };

  } catch (error: any) {
    return { success: false, error: error.message || 'Submit failed' };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { SlotInfo, BookingResult, UserInfo };
