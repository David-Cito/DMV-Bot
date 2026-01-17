# Action Map (Browser Inputs)

This file lists every **user input action** performed by the Playwright flow in `tests/example.spec.js`. Use it to troubleshoot when a step stops working. Duplicate actions are consolidated with fallback notes.

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

**Choose location**
Action: `.location.button-look.next` filtered by location name  
Purpose: Select a specific DMV location (e.g., Hawaii Kai).  
Notes: Fallback: scroll into view, then force click.

---

### Service Selection

**Choose service type**
Action: `page.getByText('DRIVER LICENSE & STATE ID Renewals')`  
Purpose: Select the service category for appointment type.  
Notes: Waits for step UI before click.

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
