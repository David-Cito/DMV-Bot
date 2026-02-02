# Action Map (Browser Inputs)

This file lists every **user input action** performed by the Playwright flow in `tests/bot/dmv-appointment-bot.spec.js`. Use it to troubleshoot when a step stops working. Duplicate actions are consolidated with fallback notes.

## Actions by Step

### Start Page

**Select service category**
Action: `page.getByText('Driver Licensing and')`  
Purpose: Enter the DMV appointment flow from the start page.  
Notes: Clicks the landing tile.

**Start appointment flow**
Action: `#newAppointment` (button)  
Purpose: Open the appointment wizard.  
Notes: Fallback: `#newAppointment >> text=Make Appointment` after scrolling into view.

---

### Location Selection

**Wait for location tiles to load**
Action: `page.waitForSelector('.location.button-look.next[data-loc-val]', { state: 'visible' })`
Purpose: Ensure location tiles have loaded (not just the container).
Notes: The `#location` container may be visible while still showing "Loading locations..." spinner.

**Select location by code**
Action: `.location.button-look.next[data-loc-val="${CODE}"]`
Purpose: Select a specific DMV location using its unique code.
Notes: Each location has a unique `data-loc-val` code (e.g., "KAPA", "FSCH").

**Verify location before clicking**
Action: `element.getAttribute('data-loc-nam-val')`
Purpose: Confirm the correct location is selected before clicking.
Notes: The `data-loc-nam-val` attribute contains the full location name.

**Location codes reference:**
```
Driver License Locations (green):
  CCDL - Commercial Drivers License (CDL)
  KAPA - Kapālama Driver License, State ID
  KAPO - Kapolei Driver License, State ID
  KOOL - Koolau Driver License, State ID
  WADL - Wahiawa Driver License, State ID
  WAIA - Waianae Driver License, State ID

Satellite City Halls - DL Renewals (blue):
  FSCH - Downtown Satellite City Hall
  HKAI - Hawaii Kai Satellite City Hall
  PEAR - Pearlridge Satellite City Hall
  WIND - Windward City Satellite City Hall

Satellite City Halls - Other Services (dark blue):
  ALAM - Ala Moana Satellite City Hall
  KSCH - Kapālama Satellite City Hall
  KAPS - Kapolei Satellite City Hall
  WAHI - Wahiawa Satellite City Hall
  WAIS - Waianae Satellite City Hall
```

**Example location tile HTML:**
```html
<div class="location button-look next"
     data-loc-val="KAPA"
     data-val-next="location"
     data-loc-nam-val="Kapālama Driver License, State ID"
     id="location_1">
  <span><strong>Kapālama Driver License, State ID</strong></span>
</div>
```

---

### Service Selection (Transaction)

**Wait for services to load**
Action: `page.waitForSelector('#transaction', { state: 'visible' })`
Purpose: Ensure service/transaction container has loaded.
Notes: Container is `#transaction`, not `#service`.

**Select service by value**
Action: `.transaction.button-look[data-trans-val="${VAL}"]`
Purpose: Select a specific service using its unique transaction value.
Notes: Each service has a unique `data-trans-val` (e.g., "195" for Hawaii License Renewal).

**Select service by name**
Action: `.transaction.button-look[data-trans-name="${NAME}"]`
Purpose: Select a service using its exact name.
Notes: The `data-trans-name` contains the full service name.

**Check if service is available**
Action: Check for `btn-disabled` class
Purpose: Disabled services have `btn-disabled` class and cannot be clicked.
Notes: Some services redirect to external sites (shown in `btn-subtext`).

**Service attributes:**
- `data-trans-val` - Unique ID (e.g., "195")
- `data-trans-name` - Service name (e.g., "Hawaii License Renewal")
- `data-trans-type` - Category: "DL", "IPT", "RT", "CASHIER"

**Example service HTML:**
```html
<div class="transaction button-look"
     data-trans-type="DL"
     data-trans-name="Hawaii License Renewal"
     data-trans-val="195"
     id="transaction_3">
  Hawaii License Renewal
</div>
```

**Disabled service example:**
```html
<div class="transaction button-look btn-disabled btn-contains-subtext"
     data-trans-type="IPT"
     data-trans-name="Instruction Permit Online"
     data-trans-val="290">
  Instruction Permit Online
  <div class="btn-subtext">Please visit https://knowtodrive.com/hawaii</div>
</div>
```

---

### Requirements Acknowledgement

**Accept requirements**
Action: `page.getByText('I have ALL the Required')`  
Purpose: Acknowledge required documents/conditions.  
Notes: Partial text match to handle wording changes.

---

### Calendar Interaction

**Pick first available day**
Action: `#datepicker td[data-handler="selectDay"] a.ui-state-default` (first)  
Purpose: Select the earliest available day on the calendar.  
Notes: Used to load times for the soonest appointment.

**Iterate all available days**
Action: `#datepicker td[data-handler="selectDay"][data-month][data-year] a.ui-state-default` (by day)  
Purpose: Click each available day to collect all month slots.  
Notes: Uses anchored day match (`^${day}$`) to avoid mismatches.
