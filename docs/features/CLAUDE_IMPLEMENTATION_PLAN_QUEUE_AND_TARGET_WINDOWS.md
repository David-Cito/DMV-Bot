CLAUDE_IMPLEMENTATION_PLAN_QUEUE_AND_TARGET_WINDOWS.md
1. Objective

Build a queue based managed booking system on top of the existing Supabase monitoring backend.

The system must do all of the following:

Maintain a single serialized queue (free to join)

Require a deposit at rank 10 to activate eligibility for managed booking

Only book appointments inside user approved target windows

Make target windows simple for users by using preset categories

Store target window presets in a database table so they can be adjusted without code changes

Run a queue dispatcher on a schedule (GitHub Actions)

Be idempotent and safe on repeated runs

Use locking per slot to prevent double booking

Optionally message near front users when a slot opens outside their availability, with strict rate limits

This plan intentionally separates:

Monitoring and analytics (already exists)

Queueing and booking dispatcher (new)

User preference capture (new tables and simple selection model)

Target window presets (new table that controls the options)

2. Existing Supabase backend

Do not modify these tables:

locations

runs

day_snapshots

slot_states

run_slot_counts

analysis_runs

analysis_rollups_daily

notification_subscribers

notification_state

The queue dispatcher will read from:

slot_states

locations

Everything else the queue dispatcher writes must go into new queue tables only.

3. High level user experience

Users do not choose custom times or custom date ranges.

Users choose preset categories:

Date horizon preset (one choice)

Time block presets (one or more choices)

Weekday preset (either any weekday or a selected subset of Mon to Fri)

Location preferences (one or more locations)

The presets are controlled by a database table so you can adjust them later without changing code.

Weekends are never offered. DMV is not open on weekends. The matcher must reject Sat and Sun regardless of user settings.

4. Target windows as adjustable presets in a table
4.1 Target window presets table

Create a table that defines the available presets.

Table name: target_window_presets

Columns:

id uuid primary key default gen_random_uuid()

preset_type text not null
Allowed values: date_horizon, time_block, weekday_rule

key text not null
Example: soonest, w4, w8, w12, early, late, midday, afternoon, any_weekday, custom_weekdays

label text not null
Example: Soonest Available, Within 8 Weeks, Early Morning, Any Weekday

rules_json jsonb not null
Contains the logic definition for that preset type

active boolean not null default true

sort_order int not null default 0

created_at timestamptz not null default now()

updated_at timestamptz not null default now()

Constraints and indexes:

Unique constraint on (preset_type, key)

Index on (preset_type, active, sort_order)

Seed rows must be inserted in the migration.

4.2 Preset definitions (seed data)

Use these recommended defaults.

Date horizon presets

preset_type date_horizon
key soonest
label Soonest Available
rules_json:
{
"days_ahead": 365
}

preset_type date_horizon
key w4
label Within 4 Weeks
rules_json:
{
"days_ahead": 28
}

preset_type date_horizon
key w8
label Within 8 Weeks
rules_json:
{
"days_ahead": 56
}

preset_type date_horizon
key w12
label Within 12 Weeks
rules_json:
{
"days_ahead": 84
}

Time block presets
These cover the entire DMV grid shown in the UI.
All times are in Honolulu local time.

preset_type time_block
key early
label Early Morning
rules_json:
{
"start": "08:00",
"end": "09:45"
}

preset_type time_block
key late
label Late Morning
rules_json:
{
"start": "10:00",
"end": "11:45"
}

preset_type time_block
key midday
label Midday
rules_json:
{
"start": "12:00",
"end": "13:45"
}

preset_type time_block
key afternoon
label Afternoon
rules_json:
{
"start": "14:00",
"end": "15:45"
}

Weekday rule presets
Weekends are always invalid and will be rejected regardless.

preset_type weekday_rule
key any_weekday
label Any Weekday
rules_json:
{
"mode": "any"
}

preset_type weekday_rule
key custom_weekdays
label Pick Weekdays
rules_json:
{
"mode": "custom"
}

Note: custom weekdays is a mode. The actual weekday list is stored per user.

4.3 Why presets in a table

This enables you to:

Add or adjust time blocks when the DMV schedule changes

Expand or shrink date horizons without refactoring user records

Change labels without deployments

Turn presets on or off with the active column

5. User selection tables
5.1 customers

Table name: customers

Columns:

id uuid primary key default gen_random_uuid()

phone text unique not null

email text null

created_at timestamptz not null default now()

5.2 queue_entries

Table name: queue_entries

Columns:

id uuid primary key default gen_random_uuid()

customer_id uuid not null references customers(id)

created_at timestamptz not null default now()

status text not null
Allowed values:
queued
deposit_required
active
booked
paused
expired
canceled

deposit_status text not null default 'none'
Allowed values:
none
required
paid
expired
refunded

deposit_required_at timestamptz null

deposit_paid_at timestamptz null

deposit_expires_at timestamptz null

booked_at timestamptz null

booked_location_id uuid null references locations(id)

booked_slot_datetime timestamptz null

Indexes:

queue_entries(created_at)

queue_entries(status, created_at)

queue_entries(deposit_status, created_at)

5.3 user_target_window_selections

Store user selections as preset keys and custom weekdays.
This is deliberately simple.

Table name: user_target_window_selections

Columns:

customer_id uuid primary key references customers(id)

timezone text not null default 'Pacific/Honolulu'

date_horizon_key text not null
Must match a row in target_window_presets where preset_type = date_horizon and active = true

weekday_rule_key text not null
Must match a row in target_window_presets where preset_type = weekday_rule and active = true

custom_weekdays int[] not null default empty array
Only used when weekday_rule_key = custom_weekdays
Encode weekdays as 1 to 5 meaning Mon to Fri
Never allow 6 or 7

time_block_keys text[] not null default empty array
Must contain one or more keys that exist in target_window_presets where preset_type = time_block and active = true

updated_at timestamptz not null default now()

Indexes:

gin index on time_block_keys

5.4 user_location_preferences

Table name: user_location_preferences

Columns:

customer_id uuid not null references customers(id)

location_id uuid not null references locations(id)

created_at timestamptz not null default now()

Primary key:

(customer_id, location_id)

Index:

(location_id)

This supports many locations per user.

6. Queue dispatcher data tables
6.1 queue_watermarks

Table name: queue_watermarks

Columns:

key text primary key

last_processed_at timestamptz not null

Seed row:

key slot_opened

last_processed_at now minus 10 minutes

6.2 booking_attempts

Table name: booking_attempts

Columns:

id uuid primary key default gen_random_uuid()

customer_id uuid not null references customers(id)

location_id uuid not null references locations(id)

slot_date date not null

slot_time time not null

slot_datetime_utc timestamptz not null

attempt_at timestamptz not null default now()

result text not null
Allowed values: success, fail, skipped

error_code text null

error_message text null

dispatcher_run_id uuid not null

Indexes:

booking_attempts(dispatcher_run_id)

booking_attempts(customer_id, attempt_at desc)

booking_attempts(location_id, attempt_at desc)

6.3 booking_locks

Table name: booking_locks

Columns:

lock_key text primary key

locked_until timestamptz not null

owner_run_id uuid not null

Index:

booking_locks(locked_until)

6.4 message_log

Table name: message_log

Columns:

id uuid primary key default gen_random_uuid()

customer_id uuid not null references customers(id)

message_type text not null
Allowed values:
deposit_needed
deposit_received
booked
opportunity_passed
status

sent_at timestamptz not null default now()

dedupe_key text not null unique

meta_json jsonb null

Indexes:

message_log(customer_id, sent_at desc)

unique constraint on dedupe_key

Messaging must always be deduped using dedupe_key.

7. Matching rules
7.1 Always reject weekends

Regardless of presets, do not match slots on Saturday or Sunday.

7.2 Date horizon match

Convert slot datetime UTC to Honolulu local date.
Compute today in Honolulu local date.
Compute allowed_end_date = today + days_ahead from the date_horizon preset.

Match if slot_date is between today and allowed_end_date inclusive.

Soonest uses 365 days which is effectively no cap.

7.3 Weekday match

Determine weekday of the slot in Honolulu local time.

If weekday_rule_key is any_weekday:

allow Mon to Fri

If weekday_rule_key is custom_weekdays:

allow only those weekdays present in custom_weekdays array

custom_weekdays array must contain only 1 to 5.

7.4 Time block match

Convert slot time to Honolulu local time.
The slot must fall within at least one selected time block.

For each selected time_block_key, load preset rules_json start and end.
Match if slot_time is between start and end inclusive.

Note: the DMV slots are in 15 minute increments but the matcher must not assume that. It should work with any time that falls in the range.

8. Queue doctrine and deposit rules
8.1 Queue is serialized

Queue order is determined by queue_entries.created_at ascending for active queue states.

Queue rank is priority of evaluation, not proximity to booking.

8.2 Deposit at rank 10

Deposit enforcement rules:

Determine ordered queue entries with status in queued, deposit_required, active

Assign rank starting at 1

For ranks 1 through 10:
If deposit_status is none:

set deposit_status to required

set status to deposit_required

set deposit_required_at to now

set deposit_expires_at to now plus 120 minutes

send deposit_needed message with dedupe
dedupe_key = deposit_needed + queue_entry_id

Deposit expiry:

If deposit_status is required and now is greater than deposit_expires_at:

set deposit_status to expired

set status to queued

Eligibility:

Only users with:

status active

deposit_status paid
are eligible to be booked.

Activation of active state happens when your payment system marks the deposit paid.

The dispatcher does not implement payment itself in MVP, it only respects deposit_status fields.

9. Slot opened detection from slot_states

Use the existing slot_states table.

A slot is considered opened if:

first_seen is greater than the watermark

last_seen is within the last 3 minutes

This keeps the dispatcher focused on fresh availability.

Slot key format:

lock_key = location_id + "|" + date + "|" + time

The dispatcher converts date and time to a UTC timestamp for matching.

10. Queue dispatcher algorithm

Constants:

DISPATCH_LOOKBACK_MINUTES = 3

DEPOSIT_RANK_THRESHOLD = 10

OPPORTUNITY_MESSAGE_RANK_THRESHOLD = 20

DEPOSIT_GRACE_MINUTES = 120

LOCK_TTL_SECONDS = 120

Step 1 Load watermark

Read queue_watermarks for key slot_opened

If missing, use now minus 10 minutes

Step 2 Fetch opened slots
Query slot_states for:

first_seen > watermark

last_seen > now minus DISPATCH_LOOKBACK_MINUTES

order by first_seen asc

Step 3 Enforce deposit requirements

Load queue entries ordered by created_at asc where status in queued, deposit_required, active

Compute rank and apply deposit rules in section 8

Step 4 For each opened slot
For each slot:

A Acquire lock

Attempt to acquire booking_locks row for lock_key

Acquire succeeds if:

no row exists, or

locked_until < now

If acquired, set locked_until = now + LOCK_TTL_SECONDS and owner_run_id = dispatcher_run_id

If not acquired, skip this slot

B Find first eligible user

Load ordered queue entries (or reuse from Step 3)

Scan in order until you find the first eligible user that matches (evaluate in this order):

status active

deposit_status paid

user has a location preference that includes this slot location

user target window selection matches the slot

While scanning, track near front users:

If rank <= 20

If all conditions pass except the target window match

Flag them for opportunity passed messaging

C If no eligible user found

Release lock early by setting locked_until = now

Continue

D Attempt booking
Call bookSlot(customer_id, location_id, slot_datetime_utc)
For MVP, bookSlot is a stub that returns failure.

E Write booking_attempts
Insert a booking_attempt row for the selected user with success or fail.

F On success

Update queue_entries for that customer to:

status booked

booked_at now

booked_location_id

booked_slot_datetime

Send booked message with dedupe

G On fail

Keep user active

Do not cascade to the next user for the same slot in MVP

Step 5 Opportunity passed messaging
For each flagged user:

Rate limit to once per day per user

dedupe_key = opportunity_passed + customer_id + date string

Do not include exact dates or times

Suggest widening availability optionally

Confirm the system will never book outside approved availability

Step 6 Advance watermark

new watermark = max(first_seen) from processed slots

Update queue_watermarks last_processed_at

Step 7 Summary logs
Print:

dispatcher_run_id

old watermark

new watermark

opened_slots_count

deposit_required_set_count

booking_attempt_count

booking_success_count

opportunity_passed_sent_count

11. Message templates

deposit_needed

Inform user they are near the front

Deposit required to hold place and activate managed booking

Include placeholder pay link

booked

Confirm booking success

Include location and exact date time

Include short next steps placeholder

opportunity_passed

Do not include exact times or dates

Explain an opening appeared outside their selected availability

Offer to widen availability

Reassure that the system never books outside approved availability

Dedupe rules:

Each message must be written to message_log first or via upsert

dedupe_key must be unique per intended send

12. Code layout

Use TypeScript.

Recommended structure:

apps/worker/queue_dispatch.ts

apps/worker/book_slot.ts

apps/worker/templates.ts

packages/core/target_window_matcher.ts

packages/core/types.ts

packages/db/supabase_client.ts

packages/db/presets.ts

packages/db/slots.ts

packages/db/queue.ts

packages/db/locks.ts

packages/db/attempts.ts

packages/db/messages.ts

packages/db/selections.ts

packages/db/locations.ts

supabase/migrations/YYYYMMDD_queue_and_target_windows.sql

13. GitHub Actions schedule

Create a workflow that runs queue_dispatch on a schedule.

Requirements:

Runs every 1 minute

Uses concurrency to prevent overlap

Uses secrets for SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY

Prints the summary logs

14. Implementation sections for Claude

Claude must implement in the exact order below and stop at the end of each section.

Section 1 Database migration

Deliverables:

Migration SQL that creates all new tables:
customers
queue_entries
target_window_presets
user_target_window_selections
user_location_preferences
queue_watermarks
booking_attempts
booking_locks
message_log

Seed rows for target_window_presets

Seed row for queue_watermarks key slot_opened

Acceptance:

Migration applies cleanly in Supabase

Unique constraint exists on message_log.dedupe_key

Unique constraint exists on target_window_presets(preset_type, key)

Section 2 Implementation Plan: DB Access Layer (Final)
Overview

Implement small single purpose database access functions for the queue and target window system.

Rules:

No business logic in db helpers

Use conditional updates to prevent race conditions

Errors are thrown with context

Empty results return null or empty arrays as appropriate

All functions use getSupabaseClient()

Database time is used for concurrency sensitive operations where relevant

Files to Create or Modify
1. packages/db/watermarks.ts

Functions:

fetchWatermark(key: string): Promise<QueueWatermark | null>

updateWatermark(key: string, lastProcessedAt: Date): Promise<void>

Notes:

Watermarks may use application time

No comparisons or logic beyond simple read write

2. packages/db/presets.ts

Functions:

fetchActivePresetsByType(presetType: PresetType): Promise<TargetWindowPreset[]>

fetchPresetByKey(presetType: PresetType, key: string): Promise<TargetWindowPreset | null>

Notes:

Query target_window_presets table

Filter active = true

Order by sort_order ASC

3. packages/db/selections.ts

Functions:

fetchUserSelection(customerId: string): Promise<UserTargetWindowSelection | null>

upsertUserSelection(selection: Omit<UserTargetWindowSelection, 'updated_at'>): Promise<UserTargetWindowSelection>

Notes:

No validation of selection contents in db layer

updated_at handled automatically by database default

4. packages/db/customers.ts

Functions:

fetchCustomerById(customerId: string): Promise<Customer | null>

fetchCustomerByPhone(phone: string): Promise<Customer | null>

upsertCustomer(params: { phone: string; email?: string }): Promise<Customer>

Notes:

phone is the primary identifier

Upsert behavior must be idempotent

5. packages/db/locations.ts

Functions:

fetchLocationById(locationId: string): Promise<Location | null>

fetchUserLocationPreferences(customerId: string): Promise<UserLocationPreference[]>

fetchUserLocationPreferencesByCustomerIds(customerIds: string[]): Promise<Map<string, UserLocationPreference[]>>

addUserLocationPreference(customerId: string, locationId: string): Promise<UserLocationPreference>

removeUserLocationPreference(customerId: string, locationId: string): Promise<void>

Notes:

Batch fetch returns Map keyed by customerId

Use shared Location type from packages/core/types

6. packages/db/slots.ts

Functions:

fetchOpenedSlotsSinceWatermark(watermark: Date, lookbackMinutes: number): Promise<SlotState[]>

Implementation:

Uses PostgreSQL RPC function fetch_opened_slots_since

RPC logic:

Reads from slot_states table

Filters:

first_seen > watermark

last_seen > now() minus lookbackMinutes

Orders by first_seen ASC

Uses database now() for time comparison

Post processing in slots.ts:

Skip rows with null date or time

Map row.date to slot_date

Map row.time to slot_time

Normalize slot_time to HH:MM:SS format before returning

7. packages/db/queue.ts

Functions:

fetchOrderedQueueEntries(): Promise<QueueEntry[]>

status IN ('queued','deposit_required','active')

order by created_at ASC

setDepositRequired(queueEntryId: string, expiresAt: Date): Promise<void>

Conditional update only if:

deposit_status = 'none'

expireDeposit(queueEntryId: string): Promise<void>

Uses application timestamp (new Date) for expiry guard

Conditional update only if:

deposit_status = 'required'

deposit_expires_at < provided timestamp

updateBookedState(queueEntryId: string, locationId: string, slotDatetime: Date): Promise<void>

fetchQueueEntryByCustomer(customerId: string): Promise<QueueEntry | null>

Notes:

No payment logic

No queue ranking logic

Conditional guards are required to avoid race conditions

8. packages/db/locks.ts

Functions:

acquireLock(lockKey: string, ownerRunId: string, ttlSeconds: number): Promise<boolean>

releaseLock(lockKey: string): Promise<void>

fetchLock(lockKey: string): Promise<BookingLock | null>

Implementation:

Uses PostgreSQL RPC function acquire_booking_lock

RPC rules:

Atomic

Uses database now() for all comparisons

Lock acquired only if:

No row exists OR locked_until < now()

Returns boolean true if acquired, false otherwise

Does not throw on contention

Callable via supabase.rpc

Usable under service role

9. packages/db/attempts.ts

Functions:

insertBookingAttempt(params: InsertBookingAttemptParams): Promise<BookingAttempt>

fetchBookingAttemptsByCustomer(customerId: string, limit?: number): Promise<BookingAttempt[]>

Notes:

No retry or aggregation logic in db layer

10. packages/db/messages.ts

Functions:

insertMessageWithDedupe(params: InsertMessageParams): Promise<MessageLogEntry | null>

fetchMessagesByCustomer(customerId: string, limit?: number): Promise<MessageLogEntry[]>

Implementation:

Attempt INSERT into message_log

If unique constraint violation on dedupe_key occurs, return null

Otherwise return the inserted row

Do not use upsert semantics that overwrite existing rows

11. packages/db/batch.ts

Functions:

fetchUserSelectionsByCustomerIds(customerIds: string[]): Promise<Map<string, UserTargetWindowSelection>>

fetchCustomersByIds(customerIds: string[]): Promise<Map<string, Customer>>

Purpose:

Avoid N plus 1 queries in dispatcher

No business logic

Return Map keyed by customerId

12. packages/core/slot_keys.ts

Functions:

buildSlotKey(locationId: string, slotDate: string, slotTime: string): string

Format:

locationId|YYYY-MM-DD|HH:MM:SS

Notes:

slotTime must be normalized before key creation

13. packages/db/index.ts

Exports:

supabase_client

presets

selections

customers

locations

slots

queue

locks

attempts

messages

watermarks

batch

Purpose:

Single import surface for db layer

14. Migration Update

File:

supabase/migrations/20260120_queue_and_target_windows.sql

Add PostgreSQL functions:

Function 1: acquire_booking_lock

Signature:

acquire_booking_lock(
p_lock_key TEXT,
p_owner_run_id UUID,
p_ttl_seconds INT
) RETURNS BOOLEAN

Rules:

Atomic

Uses database now() for all comparisons

Inserts new lock or updates existing lock only if expired

Returns true if lock acquired, false otherwise

Function 2: fetch_opened_slots_since

Signature:

fetch_opened_slots_since(
p_watermark TIMESTAMPTZ,
p_lookback_minutes INT
) RETURNS SETOF slot_states

Rules:

Uses database now()

Filters:

first_seen > p_watermark

last_seen > now() minus p_lookback_minutes

Orders by first_seen ASC

Implementation Pattern

All functions follow:

Call getSupabaseClient()

Throw on error with context

Return null for not found

Return [] for empty lists

Do not log or swallow errors

Verification

TypeScript builds clean

No business logic in db layer

No hardcoded time windows

Database time used for locks and slot availability

No N plus 1 query patterns in dispatcher usage

This version is canonical.

Section 3 Target window matcher

Deliverables:

target_window_matcher that takes:

slot_datetime_utc

user selection keys and custom weekdays

presets for date horizon and time blocks and weekday rule

timezone

returns true or false

unit tests covering:

weekday exclusion for weekends

date horizon bounds

time block bounds

custom weekdays

Acceptance:

Works in Pacific/Honolulu timezone

Matches all the appointment times shown in the UI

Section 4 Dispatcher implementation

Deliverables:

queue_dispatch.ts that implements section 10 exactly

booking stub in book_slot.ts

templates.ts and message sending skeleton that writes message_log

Acceptance:

Idempotent repeated runs

Locking prevents double booking attempts per slot key

Deposit enforcement occurs at rank 10

Only status active and deposit_status paid are eligible

Opportunity passed messages only for rank <= 20 and once per day

Section 5 GitHub Actions workflow

Deliverables:

Workflow YAML scheduled every minute

Concurrency enabled to prevent overlap

Uses Node and installs dependencies

Runs dispatcher

Acceptance:

Workflow runs successfully and prints summary logs

15. Notes and constraints

Weekends are always rejected in the matcher

Presets are adjustable in the database and the matcher must read presets at runtime

The system must not depend on hardcoded time block values in code

Booking is a stub until dispatcher stability is proven

Payments integration is out of scope for dispatcher MVP, but the dispatcher respects deposit_status

16. What Claude should not do

Do not modify existing monitoring tables

Do not refactor unrelated code

Do not introduce custom user defined time ranges

Do not add complex scheduling UI logic

Do not include exact slot times in opportunity passed messages

17. How to implement with Claude

Work section by section.

After each section:

run migration or tests

confirm acceptance criteria

commit changes

Only then move to the next section.