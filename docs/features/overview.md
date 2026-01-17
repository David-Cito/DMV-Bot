# Overview

## Purpose
Automate DMV appointment monitoring for specific locations, detect better (sooner) appointments, and notify users quickly so they can book.

## Goals
- Catch short-lived openings (same-day or within 7 days).
- Reduce manual checking effort.
- Provide actionable alerts with relevant context.
- Preserve a clean audit trail of changes for analysis.

## Current Features
- Automated Playwright flow through the DMV site.
- Location-by-location scan for the earliest available appointment.
- Historical tracking of earliest appointment changes.
- Month snapshot capture for available days/times.
- Analytics scripts for patterns, booking insights, and 7-day availability.

## Planned Features
- Dynamic pricing and deposits based on target window constraints.
- Queue system to group users by constraints (location, date window, urgency).
- Notification system with free channels and incentives for use.
- Booking system that supports approval-based booking and auto-booking with prefilled user info.
- Backend/database for scalable storage and user management.
