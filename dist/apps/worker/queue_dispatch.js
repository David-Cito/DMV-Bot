"use strict";
// Queue dispatcher implementation
// See IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md Section 10
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDispatcher = runDispatcher;
const crypto_1 = require("crypto");
const db_1 = require("../../packages/db");
const core_1 = require("../../packages/core");
const book_slot_1 = require("./book_slot");
const templates_1 = require("./templates");
const DISPATCH_LOOKBACK_MINUTES = 3;
const DEPOSIT_RANK_THRESHOLD = 10;
const OPPORTUNITY_MESSAGE_RANK_THRESHOLD = 20;
const DEPOSIT_GRACE_MINUTES = 120;
const LOCK_TTL_SECONDS = 120;
const WATERMARK_KEY = 'slot_opened';
const HONOLULU_TZ = 'Pacific/Honolulu';
async function runDispatcher() {
    const dispatcherRunId = (0, crypto_1.randomUUID)();
    const now = new Date();
    const storedWatermark = await (0, db_1.fetchWatermark)(WATERMARK_KEY);
    const fallbackWatermark = new Date(now.getTime() - 10 * 60 * 1000);
    const oldWatermark = storedWatermark?.last_processed_at ?? fallbackWatermark;
    const openedSlots = await (0, db_1.fetchOpenedSlotsSinceWatermark)(oldWatermark, DISPATCH_LOOKBACK_MINUTES);
    const queueEntries = await (0, db_1.fetchOrderedQueueEntries)();
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
            await (0, db_1.setDepositRequired)(entry.id, expiresAt);
            const depositMessage = (0, templates_1.getDepositNeededMessage)();
            const dedupeKey = `deposit_needed:${entry.id}`;
            const logged = await (0, templates_1.logMessageWithDedupe)(entry.customer_id, depositMessage, dedupeKey);
            if (logged) {
                depositRequiredSetCount += 1;
            }
        }
        if (entry.deposit_status === 'required' &&
            entry.deposit_expires_at &&
            entry.deposit_expires_at.getTime() < now.getTime()) {
            await (0, db_1.expireDeposit)(entry.id);
        }
    }
    const customerIds = queueEntries.map((entry) => entry.customer_id);
    const selectionsByCustomer = await (0, db_1.fetchUserSelectionsByCustomerIds)(customerIds);
    const preferencesByCustomer = await (0, db_1.fetchUserLocationPreferencesByCustomerIds)(customerIds);
    const datePresets = await (0, db_1.fetchActivePresetsByType)('date_horizon');
    const timePresets = await (0, db_1.fetchActivePresetsByType)('time_block');
    const weekdayPresets = await (0, db_1.fetchActivePresetsByType)('weekday_rule');
    const datePresetByKey = indexPresets(datePresets);
    const timePresetByKey = indexPresets(timePresets);
    const weekdayPresetByKey = indexPresets(weekdayPresets);
    const opportunityCandidates = new Set();
    const locationCache = new Map();
    for (const slot of openedSlots) {
        const lockKey = (0, core_1.buildSlotKey)(slot.location_id, slot.slot_date, slot.slot_time);
        const lockAcquired = await (0, db_1.acquireLock)(lockKey, dispatcherRunId, LOCK_TTL_SECONDS);
        if (!lockAcquired) {
            continue;
        }
        let selectedEntry = null;
        let selectedSlotDatetimeUtc = null;
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
                .filter(isTimeBlockPreset);
            if (!datePreset ||
                !weekdayPreset ||
                !isDateHorizonPreset(datePreset) ||
                !isWeekdayRulePreset(weekdayPreset) ||
                blockPresets.length === 0) {
                continue;
            }
            const slotDatetimeUtc = buildSlotDatetimeUtc(slot.slot_date, slot.slot_time);
            if (!slotDatetimeUtc) {
                continue;
            }
            const matchesWindow = (0, core_1.matchesTargetWindow)({
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
            await (0, db_1.releaseLock)(lockKey);
            continue;
        }
        const bookingResult = await (0, book_slot_1.bookSlot)(selectedEntry.customer_id, slot.location_id, selectedSlotDatetimeUtc);
        bookingAttemptCount += 1;
        await (0, db_1.insertBookingAttempt)({
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
            await (0, db_1.updateBookedState)(selectedEntry.id, slot.location_id, selectedSlotDatetimeUtc);
            const locationName = await getLocationName(slot.location_id, locationCache);
            const bookedMessage = (0, templates_1.getBookedMessage)(locationName, selectedSlotDatetimeUtc);
            const dedupeKey = `booked:${selectedEntry.customer_id}:${slot.slot_date}:${slot.slot_time}`;
            await (0, templates_1.logMessageWithDedupe)(selectedEntry.customer_id, bookedMessage, dedupeKey);
        }
    }
    for (const candidateKey of opportunityCandidates.values()) {
        const [customerId] = candidateKey.split(':');
        const opportunityMessage = (0, templates_1.getOpportunityPassedMessage)();
        const dedupeKey = `opportunity_passed:${candidateKey}`;
        const logged = await (0, templates_1.logMessageWithDedupe)(customerId, opportunityMessage, dedupeKey);
        if (logged) {
            opportunityPassedSentCount += 1;
        }
    }
    if (openedSlots.length > 0) {
        const maxFirstSeen = openedSlots.reduce((latest, slot) => {
            return slot.first_seen > latest ? slot.first_seen : latest;
        }, openedSlots[0].first_seen);
        await (0, db_1.updateWatermark)(WATERMARK_KEY, maxFirstSeen);
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
function indexPresets(presets) {
    return new Map(presets.map((preset) => [preset.key, preset]));
}
function isDateHorizonPreset(preset) {
    return preset.preset_type === 'date_horizon';
}
function isWeekdayRulePreset(preset) {
    return preset.preset_type === 'weekday_rule';
}
function isTimeBlockPreset(preset) {
    return !!preset && preset.preset_type === 'time_block';
}
function buildSlotDatetimeUtc(slotDate, slotTime) {
    const dateTime = `${slotDate}T${slotTime}-10:00`;
    const parsed = new Date(dateTime);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return parsed;
}
function getHonoluluDateKey(date) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: HONOLULU_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    return formatter.format(date);
}
async function getLocationName(locationId, cache) {
    const cached = cache.get(locationId);
    if (cached) {
        return cached;
    }
    const location = await (0, db_1.fetchLocationById)(locationId);
    const name = location?.name ?? 'Unknown Location';
    cache.set(locationId, name);
    return name;
}
//# sourceMappingURL=queue_dispatch.js.map
