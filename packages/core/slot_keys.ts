// Slot key utilities for building lock keys
// See IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md

/**
 * Builds a slot key from location ID, date, and time.
 * Format: locationId|YYYY-MM-DD|HH:MM:SS
 *
 * Used for distributed lock keys to prevent multiple booking attempts
 * for the same slot.
 */
export function buildSlotKey(locationId: string, slotDate: string, slotTime: string): string {
  return `${locationId}|${slotDate}|${normalizeTimeToHHMMSS(slotTime)}`;
}

function normalizeTimeToHHMMSS(time: string): string {
  if (!time) return '00:00:00';

  if (/^\d{2}:\d{2}:\d{2}$/.test(time)) {
    return time;
  }

  if (/^\d{2}:\d{2}$/.test(time)) {
    return `${time}:00`;
  }

  const parts = time.split(':');
  const hours = (parts[0] || '00').padStart(2, '0');
  const minutes = (parts[1] || '00').padStart(2, '0');
  const seconds = (parts[2] || '00').padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
}

