// Queue dispatcher implementation
// See CLAUDE_IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md Section 10

import { randomUUID } from 'crypto';

import {
  fetchActivePresetsByType,
  fetchOpenedSlotsSinceWatermark,
  fetchOrderedQueueEntries,
  fetchUserLocationPreferencesByCustomerIds,
  fetchUserSelectionsByCustomerIds,
  fetchWatermark,
  insertBookingAttempt,
  releaseLock,
  setDepositRequired,
  updateBookedState,
  updateWatermark,
  acquireLock,
  expireDeposit,
  fetchLocationById,
} from '../../packages/db';
import { buildSlotKey, matchesTargetWindow } from '../../packages/core';
import type { TimeBlockPreset, UserTargetWindowSelection } from '../../packages/core';
import { bookSlot } from './book_slot';
import {
  getBookedMessage,
  getDepositNeededMessage,
  getOpportunityPassedMessage,
  logMessageWithDedupe,
} from './templates';

const DISPATCH_LOOKBACK_MINUTES = 3;
const DEPOSIT_RANK_THRESHOLD = 10;
const OPPORTUNITY_MESSAGE_RANK_THRESHOLD = 20;
const DEPOSIT_GRACE_MINUTES = 120;
const LOCK_TTL_SECONDS = 120;

const WATERMARK_KEY = 'slot_opened';
const HONOLULU_TZ = 'Pacific/Honolulu';

export async function runDispatcher(): Promise<void> {
  const dispatcherRunId = randomUUID();
  const now = new Date();

  const storedWatermark = await fetchWatermark(WATERMARK_KEY);
  const fallbackWatermark = new Date(now.getTime() - 10 * 60 * 1000);
  const oldWatermark = storedWatermark?.last_processed_at ?? fallbackWatermark;

  const openedSlots = await fetchOpenedSlotsSinceWatermark(
    oldWatermark,
    DISPATCH_LOOKBACK_MINUTES
  );

  const queueEntries = await fetchOrderedQueueEntries();

  let depositRequiredSetCount = 0;
  let bookingAttemptCount = 0;
  let bookingSuccessCount = 0;
  let opportunityPassedSentCount = 0;

  // Step 3: Enforce deposit requirements
  for (let index = 0; index < queueEntries.length; index += 1) {
    const entry = queueEntries[index];
    const rank = index + 1;

    if (rank <= DEPOSIT_RANK_THRESHOLD && entry.deposit_status === 'none') {
      const expiresAt = new Date(now.getTime() + DEPOSIT_GRACE_MINUTES * 60 * 1000);
      await setDepositRequired(entry.id, expiresAt);
      const depositMessage = getDepositNeededMessage();
      const dedupeKey = `deposit_needed:${entry.id}`;
      const logged = await logMessageWithDedupe(entry.customer_id, depositMessage, dedupeKey);
      if (logged) {
        depositRequiredSetCount += 1;
      }
    }

    if (
      entry.deposit_status === 'required' &&
      entry.deposit_expires_at &&
      entry.deposit_expires_at.getTime() < now.getTime()
    ) {
      await expireDeposit(entry.id);
    }
  }

  const customerIds = queueEntries.map((entry) => entry.customer_id);
  const selectionsByCustomer = await fetchUserSelectionsByCustomerIds(customerIds);
  const preferencesByCustomer = await fetchUserLocationPreferencesByCustomerIds(customerIds);

  const datePresets = await fetchActivePresetsByType('date_horizon');
  const timePresets = await fetchActivePresetsByType('time_block');
  const weekdayPresets = await fetchActivePresetsByType('weekday_rule');
  const datePresetByKey = indexPresets(datePresets);
  const timePresetByKey = indexPresets(timePresets);
  const weekdayPresetByKey = indexPresets(weekdayPresets);

  const opportunityCandidates = new Set<string>();
  const locationCache = new Map<string, string>();

  for (const slot of openedSlots) {
    const lockKey = buildSlotKey(slot.location_id, slot.slot_date, slot.slot_time);
    const lockAcquired = await acquireLock(lockKey, dispatcherRunId, LOCK_TTL_SECONDS);
    if (!lockAcquired) {
      continue;
    }

    let selectedEntry = null;
    let selectedSlotDatetimeUtc: Date | null = null;

    for (let index = 0; index < queueEntries.length; index += 1) {
      const entry = queueEntries[index];
      const rank = index + 1;

      if (entry.status !== 'active' || entry.deposit_status !== 'paid') {
        continue;
      }

      const prefs = preferencesByCustomer.get(entry.customer_id) ?? [];
      const matchesLocation = prefs.some((pref) => pref.location_id === slot.location_id);
      if (!matchesLocation) {
        continue;
      }

      const selection = selectionsByCustomer.get(entry.customer_id);
      if (!selection) {
        continue;
      }

      const datePreset = datePresetByKey.get(selection.date_horizon_key);
      const weekdayPreset = weekdayPresetByKey.get(selection.weekday_rule_key);
      const blockPresets = selection.time_block_keys
        .map((key) => timePresetByKey.get(key))
        .filter(Boolean) as TimeBlockPreset[];

      if (!datePreset || !weekdayPreset || blockPresets.length === 0) {
        continue;
      }

      const slotDatetimeUtc = buildSlotDatetimeUtc(slot.slot_date, slot.slot_time);
      if (!slotDatetimeUtc) {
        continue;
      }

      const matchesWindow = matchesTargetWindow({
        slotDatetimeUtc,
        userSelection: selection,
        dateHorizonPreset: datePreset,
        timeBlockPresets: blockPresets,
        weekdayRulePreset: weekdayPreset,
        timezone: selection.timezone,
      });

      if (matchesWindow) {
        selectedEntry = entry;
        selectedSlotDatetimeUtc = slotDatetimeUtc;
        break;
      }

      if (rank <= OPPORTUNITY_MESSAGE_RANK_THRESHOLD) {
        const dateKey = getHonoluluDateKey(now);
        const candidateKey = `${entry.customer_id}:${dateKey}`;
        opportunityCandidates.add(candidateKey);
      }
    }

    if (!selectedEntry || !selectedSlotDatetimeUtc) {
      await releaseLock(lockKey);
      continue;
    }

    const bookingResult = await bookSlot(
      selectedEntry.customer_id,
      slot.location_id,
      selectedSlotDatetimeUtc
    );
    bookingAttemptCount += 1;

    await insertBookingAttempt({
      customerId: selectedEntry.customer_id,
      locationId: slot.location_id,
      slotDate: slot.slot_date,
      slotTime: slot.slot_time,
      slotDatetimeUtc: selectedSlotDatetimeUtc,
      result: bookingResult.success ? 'success' : 'fail',
      errorCode: bookingResult.errorCode,
      errorMessage: bookingResult.errorMessage,
      dispatcherRunId,
    });

    if (bookingResult.success) {
      bookingSuccessCount += 1;
      await updateBookedState(
        selectedEntry.id,
        slot.location_id,
        selectedSlotDatetimeUtc
      );

      const locationName = await getLocationName(slot.location_id, locationCache);
      const bookedMessage = getBookedMessage(locationName, selectedSlotDatetimeUtc);
      const dedupeKey = `booked:${selectedEntry.customer_id}:${slot.slot_date}:${slot.slot_time}`;
      await logMessageWithDedupe(selectedEntry.customer_id, bookedMessage, dedupeKey);
    }
  }

  for (const candidateKey of opportunityCandidates.values()) {
    const [customerId] = candidateKey.split(':');
    const opportunityMessage = getOpportunityPassedMessage();
    const dedupeKey = `opportunity_passed:${candidateKey}`;
    const logged = await logMessageWithDedupe(customerId, opportunityMessage, dedupeKey);
    if (logged) {
      opportunityPassedSentCount += 1;
    }
  }

  if (openedSlots.length > 0) {
    const maxFirstSeen = openedSlots.reduce((latest, slot) => {
      return slot.first_seen > latest ? slot.first_seen : latest;
    }, openedSlots[0].first_seen);
    await updateWatermark(WATERMARK_KEY, maxFirstSeen);
  }

  const summary = {
    dispatcher_run_id: dispatcherRunId,
    old_watermark: oldWatermark.toISOString(),
    new_watermark: openedSlots.length
      ? openedSlots
          .reduce((latest, slot) => (slot.first_seen > latest ? slot.first_seen : latest), openedSlots[0].first_seen)
          .toISOString()
      : oldWatermark.toISOString(),
    opened_slots_count: openedSlots.length,
    deposit_required_set_count: depositRequiredSetCount,
    booking_attempt_count: bookingAttemptCount,
    booking_success_count: bookingSuccessCount,
    opportunity_passed_sent_count: opportunityPassedSentCount,
  };

  console.log('queue_dispatch_summary', summary);
}

function indexPresets<T extends { key: string }>(presets: T[]): Map<string, T> {
  return new Map(presets.map((preset) => [preset.key, preset]));
}

function buildSlotDatetimeUtc(slotDate: string, slotTime: string): Date | null {
  const dateTime = `${slotDate}T${slotTime}-10:00`;
  const parsed = new Date(dateTime);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function getHonoluluDateKey(date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: HONOLULU_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

async function getLocationName(
  locationId: string,
  cache: Map<string, string>
): Promise<string> {
  const cached = cache.get(locationId);
  if (cached) {
    return cached;
  }
  const location = await fetchLocationById(locationId);
  const name = location?.name ?? 'Unknown Location';
  cache.set(locationId, name);
  return name;
}
