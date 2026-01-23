import { strict as assert } from 'node:assert';
import test from 'node:test';

import type {
  DateHorizonPreset,
  TimeBlockPreset,
  UserTargetWindowSelection,
  WeekdayRulePreset,
} from './types';
import { matchesTargetWindow } from './target_window_matcher';

const BASE_SELECTION: UserTargetWindowSelection = {
  customer_id: 'customer-1',
  timezone: 'Pacific/Honolulu',
  date_horizon_key: 'custom',
  weekday_rule_key: 'any_weekday',
  custom_weekdays: [],
  time_block_keys: ['early'],
  updated_at: new Date('2026-01-06T00:00:00-10:00'),
};

const DATE_HORIZON_PRESET: DateHorizonPreset = {
  id: 'preset-date',
  preset_type: 'date_horizon',
  key: 'custom',
  label: 'Custom',
  active: true,
  sort_order: 1,
  created_at: new Date('2026-01-01T00:00:00-10:00'),
  updated_at: new Date('2026-01-01T00:00:00-10:00'),
  rules_json: { days_ahead: 0 },
};

const WEEKDAY_ANY: WeekdayRulePreset = {
  id: 'preset-weekday-any',
  preset_type: 'weekday_rule',
  key: 'any_weekday',
  label: 'Any Weekday',
  active: true,
  sort_order: 1,
  created_at: new Date('2026-01-01T00:00:00-10:00'),
  updated_at: new Date('2026-01-01T00:00:00-10:00'),
  rules_json: { mode: 'any' },
};

const WEEKDAY_CUSTOM: WeekdayRulePreset = {
  id: 'preset-weekday-custom',
  preset_type: 'weekday_rule',
  key: 'custom_weekdays',
  label: 'Custom Weekdays',
  active: true,
  sort_order: 2,
  created_at: new Date('2026-01-01T00:00:00-10:00'),
  updated_at: new Date('2026-01-01T00:00:00-10:00'),
  rules_json: { mode: 'custom' },
};

const EARLY_BLOCK: TimeBlockPreset = {
  id: 'preset-time-early',
  preset_type: 'time_block',
  key: 'early',
  label: 'Early Morning',
  active: true,
  sort_order: 1,
  created_at: new Date('2026-01-01T00:00:00-10:00'),
  updated_at: new Date('2026-01-01T00:00:00-10:00'),
  rules_json: { start: '08:00', end: '09:45' },
};

test('rejects weekends regardless of preset', () => {
  const input = {
    slotDatetimeUtc: new Date('2026-01-17T09:00:00-10:00'), // Saturday in Honolulu
    userSelection: BASE_SELECTION,
    dateHorizonPreset: { ...DATE_HORIZON_PRESET, rules_json: { days_ahead: 365 } },
    timeBlockPresets: [EARLY_BLOCK],
    weekdayRulePreset: WEEKDAY_ANY,
    timezone: 'Pacific/Honolulu',
    now: new Date('2026-01-10T12:00:00-10:00'),
  };

  assert.equal(matchesTargetWindow(input), false);
});

test('date horizon bounds are inclusive', () => {
  const now = new Date('2026-01-06T12:00:00-10:00'); // Tuesday
  const todaySlot = new Date('2026-01-06T08:00:00-10:00');
  const nextDaySlot = new Date('2026-01-07T08:00:00-10:00');

  const input = {
    slotDatetimeUtc: todaySlot,
    userSelection: BASE_SELECTION,
    dateHorizonPreset: { ...DATE_HORIZON_PRESET, rules_json: { days_ahead: 0 } },
    timeBlockPresets: [EARLY_BLOCK],
    weekdayRulePreset: WEEKDAY_ANY,
    timezone: 'Pacific/Honolulu',
    now,
  };

  assert.equal(matchesTargetWindow(input), true);
  assert.equal(matchesTargetWindow({ ...input, slotDatetimeUtc: nextDaySlot }), false);
});

test('time block bounds are inclusive', () => {
  const now = new Date('2026-01-06T12:00:00-10:00');
  const startSlot = new Date('2026-01-06T08:00:00-10:00');
  const endSlot = new Date('2026-01-06T09:45:00-10:00');
  const outsideSlot = new Date('2026-01-06T09:46:00-10:00');

  const input = {
    slotDatetimeUtc: startSlot,
    userSelection: BASE_SELECTION,
    dateHorizonPreset: { ...DATE_HORIZON_PRESET, rules_json: { days_ahead: 1 } },
    timeBlockPresets: [EARLY_BLOCK],
    weekdayRulePreset: WEEKDAY_ANY,
    timezone: 'Pacific/Honolulu',
    now,
  };

  assert.equal(matchesTargetWindow(input), true);
  assert.equal(matchesTargetWindow({ ...input, slotDatetimeUtc: endSlot }), true);
  assert.equal(matchesTargetWindow({ ...input, slotDatetimeUtc: outsideSlot }), false);
});

test('custom weekdays restrict matches to selected weekdays', () => {
  const now = new Date('2026-01-06T12:00:00-10:00'); // Tuesday
  const tuesdaySlot = new Date('2026-01-06T08:00:00-10:00');
  const wednesdaySlot = new Date('2026-01-07T08:00:00-10:00');

  const selection: UserTargetWindowSelection = {
    ...BASE_SELECTION,
    weekday_rule_key: 'custom_weekdays',
    custom_weekdays: [2, 4],
  };

  const input = {
    slotDatetimeUtc: tuesdaySlot,
    userSelection: selection,
    dateHorizonPreset: { ...DATE_HORIZON_PRESET, rules_json: { days_ahead: 7 } },
    timeBlockPresets: [EARLY_BLOCK],
    weekdayRulePreset: WEEKDAY_CUSTOM,
    timezone: 'Pacific/Honolulu',
    now,
  };

  assert.equal(matchesTargetWindow(input), true);
  assert.equal(matchesTargetWindow({ ...input, slotDatetimeUtc: wednesdaySlot }), false);
});
