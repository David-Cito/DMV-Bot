# Passive Forecast Notifications

**Status:** Backlog - Not yet implemented
**Created:** 2026-02-01

## Overview

Use forecasting bot data (days 31-60) to passively notify users about upcoming appointment availability, even though active booking only works within 30 days.

## Problem

Users currently only see slots within the 30-day booking window. They have no visibility into what's coming, which can cause anxiety or lead them to check the DMV site manually.

## Proposed Solution

Send informational notifications when the forecasting bot detects slots in the 31-60 day range.

### Notification Types

1. **Upcoming Availability Alert**
   - "Heads up: Downtown has 52 slots opening for Mar 31 - Apr 2"
   - Informational only, no action required
   - Users can manually book on DMV site if eager

2. **Weekly Forecast Summary**
   - "Next week's forecast: 150+ slots expected across all locations"
   - Helps users understand availability patterns

3. **Waitlist Match (Future)**
   - User specifies preferred date range
   - Notify when slots appear in that range
   - Auto-queue when it enters 30-day window

### User Experience

- Separate notification channel/preference for forecast alerts
- Lower priority than active booking notifications
- Optional opt-in (some users may not want extra notifications)

## Technical Notes

- Forecasting bot already captures this data (`dmv-forecast-results.json`)
- Would need new notification templates
- Consider rate limiting (don't spam users daily with same info)

## Open Questions

- Should this be email-only, or also SMS?
- How often to send forecast notifications?
- Should users be able to set date preferences for alerts?

## Decision

Deferred. Focus on core monitoring and booking functionality first. Revisit once forecasting data collection is stable and we understand user demand.
