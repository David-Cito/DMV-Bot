# Road Test Appointment Bot Specification

## Overview
Bot to monitor road test appointment availability at the Hawaii DMV road test scheduling site.

## Status: READY FOR TESTING
- **Bot code**: Complete and compiles
- **Notification script**: Complete
- **GitHub Actions workflow**: Complete with notifications enabled
- **Database tables**: Need to be created in Supabase (SQL provided below)
- **Next steps**: Run locally with `--headed` mode to verify selectors, then test full workflow

## Target Site
- **URL**: https://www12.honolulu.gov/csdarts/frmApptInt.aspx
- **Technology**: ASP.NET WebForms (uses `__doPostBack` for navigation)
- **Authentication**: Not required to view availability (only needed when booking)

## Locations
The site shows availability for 5 road test locations:
- Kapahulu
- Kapolei
- Koolau
- Wahiawa
- Waianae

## Site Structure (From User-Provided HTML)

### Page Layout
The page displays a table with:
- **Rows**: Time slots (08:00 AM - 03:30 PM in 30-minute intervals) + Stand-by row
- **Columns**: Time | Kapahulu | Kapolei | Koolau | Wahiawa | Waianae

### Appointment Table Structure
```html
<table border="1" cellpadding="1" cellspacing="0" width="100%" style="table-layout:fixed;">
  <tbody>
    <tr>
      <th nowrap="">Time</th>
      <th nowrap="">Kapahulu</th>
      <th nowrap="">Kapolei</th>
      <th nowrap="">Koolau</th>
      <th nowrap="">Wahiawa</th>
      <th nowrap="">Waianae</th>
    </tr>
    <tr class="TableItemLine">
      <td><span>08:00 AM</span></td>
      <td><span>None</span></td>  <!-- No availability -->
      <td><span>None</span></td>
      ...
    </tr>
    <tr class="TableAltItemLine">
      <td><span>08:30 AM</span></td>
      ...
    </tr>
    <!-- More time slots... -->

    <!-- Stand-by row at bottom -->
    <tr class="TableItemLine">
      <td><span class="TableFooter">Stand-by</span></td>
      <td><input type="submit" name="dlstAppointment:_ctl17:_ctl1" value="5" title="Click to reserve the appointment." style="height:20px;width:100%;"></td>
      <td><span>None</span></td>
      ...
    </tr>
  </tbody>
</table>
```

### Key Observations from HTML
1. **Available slots** = `<input type="submit">` buttons with `value` attribute (seat count)
2. **Unavailable slots** = `<span>None</span>`
3. **Row classes**: `TableItemLine` and `TableAltItemLine` alternate
4. **Stand-by row**: Has `<span class="TableFooter">Stand-by</span>` in time column
5. **Button format**: `name="dlstAppointment:_ctl17:_ctl1"` (ASP.NET naming)

### Calendar Navigation
Month navigation uses JavaScript postback:
```html
<a href="javascript:__doPostBack('Calendar1','V9556')" style="color:Black" title="Go to the next month">Mar</a>
```
- Link text = abbreviated month name (e.g., "Mar", "Apr")
- Click triggers ASP.NET postback to load that month's data

### Selectors
```yaml
appointment_table:
  container: "table[border='1'][width='100%']"
  headers: "tr:first-child th"
  data_rows: "tr.TableItemLine, tr.TableAltItemLine"
  time_cell: "td:first-child span"
  available_slot: "input[type='submit']"  # Has value attribute with seat count
  unavailable_slot: "span:has-text('None')"
  standby_indicator: ".TableFooter, span:has-text('Stand-by')"

calendar:
  container: "#Calendar1, [id*='Calendar']"
  title: "td[colspan], .title"
  next_month: "a[title*='next month']"
  prev_month: "a[title*='previous month']"
```

### Slot Types
1. **Regular slots**: Time slots from 08:00 AM to 03:30 PM (30-min intervals)
2. **Stand-by slots**: Special row at bottom, appear at 4:30pm HST for next business day

## Files Created

| File | Purpose | Status |
|------|---------|--------|
| `apps/road-test-bot/road-test-bot.ts` | Core scraping logic | Complete |
| `apps/road-test-bot/run-road-test-bot.ts` | CLI entry point | Complete |
| `.github/workflows/road-test-bot.yml` | Scheduled runs | Complete |
| `scripts/notifications/send-road-test-notifications.js` | Discord notifications | Complete |
| `openspec/specs/road-test-bot/spec.md` | This spec file | Complete |

## CLI Usage
```bash
# Run monitoring (default, 45 days)
npx ts-node apps/road-test-bot/run-road-test-bot.ts

# With visible browser for debugging
npx ts-node apps/road-test-bot/run-road-test-bot.ts --headed

# Specify scan window
npx ts-node apps/road-test-bot/run-road-test-bot.ts --headed --days=45

# Upload results to Supabase
npx ts-node apps/road-test-bot/run-road-test-bot.ts --headed --days=45 --upload

# Discovery mode (explores page structure)
npx ts-node apps/road-test-bot/run-road-test-bot.ts --discover

# Quick connectivity test
npx ts-node apps/road-test-bot/run-road-test-bot.ts --test

# Enable verbose diagnostic logging (URLs, page content, screenshots)
npx ts-node apps/road-test-bot/run-road-test-bot.ts --verbose
# Or via env var: ROAD_TEST_VERBOSE=true
```

## Data Structures

### RoadTestSlot
```typescript
interface RoadTestSlot {
  time: string;           // e.g., "08:00 AM" or "Stand-by"
  location: string;       // e.g., "Kapahulu"
  type: 'regular' | 'standby';
  buttonName?: string;    // Form button name for booking
  buttonValue?: string;   // Form button value (seat count)
}
```

### ScanResult
```typescript
interface ScanResult {
  ok: boolean;
  reason?: string;
  scannedAt: string;
  currentDate?: string;
  days: DayResult[];
  summary: {
    totalSlots: number;
    byLocation: Record<string, number>;
    earliestDate: string | null;
    earliestDaysAway: number | null;
  };
}
```

## Supabase Integration

### Tables Needed
```sql
-- Scan run records
CREATE TABLE road_test_scans (
  id TEXT PRIMARY KEY,
  scanned_at TIMESTAMPTZ NOT NULL,
  ok BOOLEAN NOT NULL,
  reason TEXT,
  total_slots INTEGER,
  slots_by_location JSONB,
  earliest_date DATE,
  earliest_days_away INTEGER
);

-- Individual slot records
CREATE TABLE road_test_slots (
  id SERIAL PRIMARY KEY,
  scan_id TEXT REFERENCES road_test_scans(id),
  scan_date DATE,
  scanned_at TIMESTAMPTZ,
  date DATE,
  time TEXT,
  location TEXT,
  slot_type TEXT,  -- 'regular' or 'standby'
  button_name TEXT,
  button_value TEXT
);
```

### Environment Variables Required
```bash
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxx
```

## Notification Rules

### Instant Alert Triggers
- Appointment available within 21 days (3 weeks)

### Daily Summary
- New slots that appeared since last check
- Slots that were removed
- Changes in availability by location

### Message Format
Include:
- Total slots found
- Breakdown by location
- Standby vs regular slot distinction
- Days away from today

## Known Issues

### ASP.NET Page Stability Issues (Resolved - GitHub Actions)

**Problem:** The bot works locally but fails in GitHub Actions with various "Execution context destroyed" and "Element not attached to DOM" errors.

**Root Cause:** The ASP.NET WebForms page has delayed JavaScript and postback behaviors that cause the DOM to change after the page appears stable. This creates race conditions where:
1. Element handles become stale between finding and clicking
2. Execution context is destroyed by async navigation during `page.evaluate()`

**Symptoms Observed:**
```
page.evaluate: Execution context was destroyed, most likely because of a navigation
page.$: Protocol error (DOM.describeNode): Cannot find context with specified id
elementHandle.click: Element is not attached to the DOM
```

**Solutions Implemented:**

1. **Use `page.click(selector)` instead of `element.click()`**
   - Element handles can become stale if DOM changes between finding and clicking
   - `page.click(selector)` re-queries the element at click time
   ```typescript
   // BAD - stale element risk
   const dayLink = await page.$(`#Calendar1 a:text-is("${dayNum}")`);
   await dayLink.click();

   // GOOD - re-queries at click time
   await page.click(`#Calendar1 a:text-is("${dayNum}")`);
   ```

2. **Use `locator().count()` for existence checks**
   - More resilient to DOM changes than getting element handles
   ```typescript
   const dayLinkCount = await page.locator(daySelector).count();
   if (dayLinkCount > 0) {
     await page.click(daySelector);
   }
   ```

3. **Wait for `networkidle` after navigation/clicks**
   - ASP.NET postbacks can trigger multiple network requests
   - `domcontentloaded` alone is not sufficient
   ```typescript
   await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
   ```

4. **Add stabilization delay before scan loop**
   - Let delayed JavaScript run before starting interactions
   ```typescript
   await sleep(500);
   await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
   ```

5. **Wrap `page.evaluate()` in try-catch with retry**
   - If context is destroyed, wait for page to stabilize and retry
   ```typescript
   try {
     result = await page.evaluate(SCRIPT);
   } catch (e) {
     await page.waitForLoadState('domcontentloaded');
     await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
     result = await page.evaluate(SCRIPT);
   }
   ```

6. **Verify URL hasn't changed before proceeding**
   - Detect if page navigated away unexpectedly
   ```typescript
   const urlBeforeScan = page.url();
   if (!urlBeforeScan.includes('frmApptInt.aspx')) {
     await page.waitForURL('**/frmApptInt.aspx', { timeout: 10000 });
   }
   ```

**Key Insight:** GitHub Actions has different timing characteristics than local development. Network latency and CPU speed differences expose race conditions that don't appear locally. Always design for worst-case timing.

### Session-Based Redirect Chain (Resolved)
The site uses a session-based redirect chain that causes first requests to hang:

**Redirect Chain (without session cookie):**
1. `www12.honolulu.gov/csdarts/frmApptInt.aspx` → 302 redirect
2. `www8.honolulu.gov/csd/road-test` → 301 redirect
3. `www.honolulu.gov/csd/road-test` → **hangs indefinitely**

**Root Cause:**
- The intermediate redirects set an `ASP.NET_SessionId` cookie on `www12.honolulu.gov`
- When this cookie exists, the server serves the page directly (200 response, no redirects)
- The final destination (`www.honolulu.gov`) appears to be misconfigured or rate-limited

**Solution Implemented:**
Before creating the page, we warm up the session using `context.request.get()`:
```typescript
// In monitorRoadTest()
try {
  await context.request.get(START_URL, { timeout: 5000 });
} catch {
  // Expected to timeout - redirect chain hangs, but cookie gets set
}
```

This warmup request:
- Goes through the redirect chain (times out as expected)
- Successfully sets the `ASP.NET_SessionId` cookie
- Subsequent `page.goto()` calls succeed immediately (~100-200ms)

**Performance Impact:**
| Approach | Total Navigation Time |
|----------|----------------------|
| No warmup (hangs) | 60+ seconds (timeout) |
| Warmup + navigation | ~5-6 seconds |

## GitHub Actions Schedule
Workflow: `.github/workflows/road-test-bot.yml`

```yaml
schedule:
  # 8am HST (6pm UTC) - morning check
  - cron: '0 18 * * *'
  # 4:30pm HST (2:30am UTC) - standby slot release time
  - cron: '30 2 * * *'
  # 6pm HST (4am UTC) - evening check
  - cron: '0 4 * * *'
```

## Testing Checklist

1. **Test selectors locally with --headed**
   ```bash
   npx ts-node apps/road-test-bot/run-road-test-bot.ts --headed --days=45
   ```
   - Verify appointment table is found
   - Verify slots are extracted correctly
   - Verify calendar navigation works

2. **Create Supabase tables** (SQL provided above in Supabase Integration section)
   - `road_test_scans`
   - `road_test_slots`

3. **Test with Supabase upload**
   ```bash
   npx ts-node apps/road-test-bot/run-road-test-bot.ts --headed --days=45 --upload
   ```

4. **Test notification workflow**
   - Trigger workflow manually with `test_notify: true`
   - Verify Discord message is sent correctly

5. **Full end-to-end test**
   - Let scheduled workflow run
   - Verify screenshots and results are uploaded as artifacts
   - Verify notifications are sent when slots are found

## Changelog
- 2024-02-03: Initial spec created
- 2024-02-03: Updated with discovered selectors from user-provided HTML
- 2024-02-03: Added table structure, calendar navigation details
- 2024-02-03: Documented 5 locations: Kapahulu, Kapolei, Koolau, Wahiawa, Waianae
- 2024-02-03: Bot code complete, blocked by network timeout during testing
- 2024-02-03: Added Supabase upload functionality
- 2024-02-03: Added --days and --upload CLI flags
- 2025-02-04: Fixed navigation timeout issue - discovered session-based redirect chain, implemented warmup solution
- 2026-02-04: Fixed ASP.NET page stability issues in GitHub Actions:
  - Added networkidle waits after navigation and postbacks
  - Switched from element.click() to page.click(selector) to avoid stale elements
  - Added try-catch retry logic around page.evaluate() calls
  - Added stabilization delay before scan loop
  - Documented patterns for handling ASP.NET WebForms timing issues
- 2026-02-04: Added --verbose/-v flag for diagnostic logging (URLs, page content, screenshots)
