// Booking Bot Runner for Queue System V2
// This is the entry point that runs on a schedule (e.g., every minute via GitHub Actions)

import { v4 as uuidv4 } from 'uuid';
import { getSupabaseClient } from '../../packages/db/supabase_client';
import { fetchRecentOpenSlots } from '../../packages/db/slots';
import { bookSlot, type SlotInfo, type BookingResult } from './booking-bot';
import { acquireSlotLock, isSlotLocked, getActiveLocations, getLocationCode } from '../../packages/queue';
import { loadBotConfig } from './bot-config';

// ============================================================================
// TYPES
// ============================================================================

interface BotRunResult {
  bot_run_id: string;
  started_at: Date;
  ended_at: Date;
  status: 'success' | 'error' | 'timeout';
  slots_found: number;
  slots_attempted: number;
  bookings_made: number;
  users_with_payment_issues: number;
  error_message?: string;
  duration_ms: number;
}

// ============================================================================
// MAIN RUNNER
// ============================================================================

export async function runBookingBot(): Promise<BotRunResult> {
  // Load configuration at startup
  await loadBotConfig();

  const supabase = getSupabaseClient();
  const botId = uuidv4();
  const startTime = Date.now();
  const startedAt = new Date();

  console.log(`[BookingBot] Starting run ${botId} at ${startedAt.toISOString()}`);

  // Log bot run start
  const { data: botRun } = await supabase
    .from('bot_runs')
    .insert({
      id: botId,
      bot_type: 'booking',
      started_at: startedAt.toISOString(),
    })
    .select()
    .single();

  const result: BotRunResult = {
    bot_run_id: botId,
    started_at: startedAt,
    ended_at: new Date(),
    status: 'success',
    slots_found: 0,
    slots_attempted: 0,
    bookings_made: 0,
    users_with_payment_issues: 0,
    duration_ms: 0,
  };

  try {
    // Get active locations
    const locations = await getActiveLocations();
    console.log(`[BookingBot] Found ${locations.length} active locations`);

    // Check each location for new slots
    for (const location of locations) {
      console.log(`[BookingBot] Checking location: ${location.name}`);

      // Fetch recent open slots from monitoring bot
      const slots = await fetchRecentOpenSlots(location.id, 5); // Last 5 minutes

      if (slots.length === 0) {
        console.log(`[BookingBot] No recent slots at ${location.name}`);
        continue;
      }

      console.log(`[BookingBot] Found ${slots.length} recent slots at ${location.name}`);
      result.slots_found += slots.length;

      // Try to book each slot
      for (const slot of slots) {
        // Check if slot is already locked
        const locked = await isSlotLocked(location.id, slot.slot_date, slot.slot_time);
        if (locked) {
          console.log(`[BookingBot] Slot ${slot.slot_date} ${slot.slot_time} already locked, skipping`);
          continue;
        }

        const locationCode = getLocationCode(location.name);
        if (!locationCode) {
          console.log(`[BookingBot] Unknown location name: ${location.name}`);
          continue;
        }

        const slotInfo: SlotInfo = {
          location_id: location.id,
          location_code: locationCode,
          slot_date: slot.slot_date,
          slot_time: slot.slot_time,
        };

        console.log(`[BookingBot] Attempting to book slot: ${slot.slot_date} ${slot.slot_time}`);
        result.slots_attempted++;

        const bookingResult = await bookSlot(slotInfo, botId);

        if (bookingResult.success) {
          console.log(`[BookingBot] Successfully booked slot for user ${bookingResult.booked_user_id}`);
          result.bookings_made++;

          // Log booking attempt
          await supabase.from('booking_attempts').insert({
            bot_run_id: botId,
            user_id: bookingResult.booked_user_id,
            location_id: location.id,
            slot_date: slot.slot_date,
            slot_time: slot.slot_time,
            result: 'success',
            payment_attempted: true,
            payment_result: 'succeeded',
          });

        } else {
          console.log(`[BookingBot] Failed to book slot: ${bookingResult.error}`);

          // Log failed attempt
          await supabase.from('booking_attempts').insert({
            bot_run_id: botId,
            location_id: location.id,
            slot_date: slot.slot_date,
            slot_time: slot.slot_time,
            result: bookingResult.error_code === 'all_payments_failed' ? 'payment_failed' : 'skipped',
            error_code: bookingResult.error_code,
            error_message: bookingResult.error,
            payment_attempted: bookingResult.users_with_payment_issues.length > 0,
            payment_result: bookingResult.users_with_payment_issues.length > 0 ? 'failed' : null,
            screenshot_url: bookingResult.screenshot_url || null,
          });
        }

        result.users_with_payment_issues += bookingResult.users_with_payment_issues.length;

        // Only attempt one booking per run to avoid overwhelming the system
        // The next run (in 1 minute) will pick up remaining slots
        if (result.bookings_made > 0) {
          break;
        }
      }

      // If we made a booking, stop checking other locations
      if (result.bookings_made > 0) {
        break;
      }
    }

    result.status = 'success';

  } catch (error: any) {
    console.error(`[BookingBot] Error: ${error.message}`);
    result.status = 'error';
    result.error_message = error.message;

    // Log system event
    await supabase.from('system_events').insert({
      event_type: 'booking_bot_error',
      severity: 'error',
      bot_run_id: botId,
      details: {
        error: error.message,
        stack: error.stack,
      },
    });

  } finally {
    result.ended_at = new Date();
    result.duration_ms = Date.now() - startTime;

    // Update bot run record
    await supabase
      .from('bot_runs')
      .update({
        ended_at: result.ended_at.toISOString(),
        status: result.status,
        slots_found: result.slots_found,
        users_attempted: result.slots_attempted,
        booking_result: result.bookings_made > 0 ? 'success' : (result.slots_attempted > 0 ? 'no_booking' : 'no_slots'),
        error_message: result.error_message,
        duration_ms: result.duration_ms,
      })
      .eq('id', botId);

    console.log(`[BookingBot] Run completed in ${result.duration_ms}ms`);
    console.log(`[BookingBot] Slots found: ${result.slots_found}, Attempted: ${result.slots_attempted}, Booked: ${result.bookings_made}`);
  }

  return result;
}

// ============================================================================
// CLI ENTRY POINT
// ============================================================================

if (require.main === module) {
  runBookingBot()
    .then((result) => {
      console.log('[BookingBot] Final result:', JSON.stringify(result, null, 2));
      process.exit(result.status === 'success' ? 0 : 1);
    })
    .catch((error) => {
      console.error('[BookingBot] Fatal error:', error);
      process.exit(1);
    });
}
