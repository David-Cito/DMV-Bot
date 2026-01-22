// Target window matcher
// See CLAUDE_IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md Section 7

import type {
  DateHorizonPreset,
  TimeBlockPreset,
  WeekdayRulePreset,
  UserTargetWindowSelection,
} from './types';

export interface MatcherInput {
  slotDatetimeUtc: Date;
  userSelection: UserTargetWindowSelection;
  dateHorizonPreset: DateHorizonPreset;
  timeBlockPresets: TimeBlockPreset[];
  weekdayRulePreset: WeekdayRulePreset;
  timezone: string;
  now?: Date;
}

export function matchesTargetWindow(input: MatcherInput): boolean {
  const slotParts = getHonoluluParts(input.slotDatetimeUtc);
  const weekdayNumber = weekdayToNumber(slotParts.weekday);
  if (weekdayNumber === null) {
    return false;
  }

  // 7.1 Always reject weekends
  if (weekdayNumber === 6 || weekdayNumber === 7) {
    return false;
  }

  // 7.2 Date horizon match (inclusive bounds)
  const daysAhead = input.dateHorizonPreset.rules_json?.days_ahead;
  if (typeof daysAhead !== 'number' || Number.isNaN(daysAhead)) {
    return false;
  }

  const now = input.now ?? new Date();
  const todayParts = getHonoluluParts(now);
  const slotDay = toDayNumber(slotParts);
  const todayDay = toDayNumber(todayParts);
  const allowedEndDay = todayDay + daysAhead;

  if (slotDay < todayDay || slotDay > allowedEndDay) {
    return false;
  }

  // 7.3 Weekday match
  if (input.weekdayRulePreset.key === 'any_weekday') {
    if (weekdayNumber < 1 || weekdayNumber > 5) {
      return false;
    }
  } else if (input.weekdayRulePreset.key === 'custom_weekdays') {
    if (!input.userSelection.custom_weekdays.includes(weekdayNumber)) {
      return false;
    }
  } else {
    return false;
  }

  // 7.4 Time block match
  if (!input.timeBlockPresets.length) {
    return false;
  }

  const slotSeconds = toSeconds(slotParts.hour, slotParts.minute, slotParts.second);
  for (const preset of input.timeBlockPresets) {
    const startSeconds = parseTimeToSeconds(preset.rules_json?.start);
    const endSeconds = parseTimeToSeconds(preset.rules_json?.end);
    if (startSeconds === null || endSeconds === null) {
      continue;
    }
    if (slotSeconds >= startSeconds && slotSeconds <= endSeconds) {
      return true;
    }
  }

  return false;
}

const HONOLULU_TZ = 'Pacific/Honolulu';
const WEEKDAY_NUMBERS: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

function getHonoluluParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: HONOLULU_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      values[part.type] = part.value;
    }
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: values.weekday,
  };
}

function weekdayToNumber(weekday: string): number | null {
  return WEEKDAY_NUMBERS[weekday] ?? null;
}

function toDayNumber(parts: { year: number; month: number; day: number }): number {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000);
}

function toSeconds(hours: number, minutes: number, seconds: number): number {
  return hours * 3600 + minutes * 60 + seconds;
}

function parseTimeToSeconds(value?: string): number | null {
  if (!value) return null;
  const [hourRaw, minuteRaw, secondRaw] = value.split(':');
  const hours = Number.parseInt(hourRaw ?? '', 10);
  const minutes = Number.parseInt(minuteRaw ?? '', 10);
  const seconds = Number.parseInt(secondRaw ?? '0', 10);
  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    Number.isNaN(seconds) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59 ||
    seconds < 0 ||
    seconds > 59
  ) {
    return null;
  }
  return toSeconds(hours, minutes, seconds);
}
