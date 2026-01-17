#!/usr/bin/env node
// Analyzes appointments that become available within 7 days and how long they stay available.
// Designed to help optimize queue/booking systems by understanding availability patterns.
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const HISTORY_DIR = path.join(ROOT, 'history');
const HISTORY_FILE = path.join(ROOT, 'dmv-history.json');
const REPORT_DIR = path.join(HISTORY_DIR, 'reports');

const dayMs = 24 * 60 * 60 * 1000;
const hourMs = 60 * 60 * 1000;
const minMs = 60 * 1000;

const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const formatDate = (s) => {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const day = d.getUTCDate();
  const month = monthNames[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  return `${month} ${day}, ${year}`;
};
const formatHst = (s) => {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return (
    d.toLocaleString('en-US', {
      timeZone: 'Pacific/Honolulu',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }) + ' HST'
  );
};
const displayLoc = (s) => (s || '').replace(/\s*Satellite City Hall$/i, '').trim() || s || 'Unknown';

function readJsonSafe(p, fallback) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.log(`Warning: failed to read ${p}: ${e && e.message ? e.message : e}`);
  }
  return fallback;
}

function loadPerLocationHistories() {
  if (!fs.existsSync(HISTORY_DIR)) return [];
  const files = fs.readdirSync(HISTORY_DIR).filter((f) => f.startsWith('dmv-month-history-') && f.endsWith('.json'));
  return files.map((f) => {
    const full = path.join(HISTORY_DIR, f);
    const data = readJsonSafe(full, { location: f, months: {} });
    return { file: full, data };
  });
}

// Parse dataVal string like "2026-03-04 12:30:00" to Date
function parseDataVal(dataVal) {
  if (!dataVal) return null;
  const d = Date.parse(dataVal);
  return Number.isFinite(d) ? new Date(d) : null;
}

// Calculate days between two dates
function daysBetween(date1, date2) {
  if (!date1 || !date2) return null;
  const d1 = typeof date1 === 'string' ? new Date(date1) : date1;
  const d2 = typeof date2 === 'string' ? new Date(date2) : date2;
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return null;
  return Math.round((d1.getTime() - d2.getTime()) / dayMs);
}

// Calculate time difference in minutes
function minutesBetween(date1, date2) {
  if (!date1 || !date2) return null;
  const d1 = typeof date1 === 'string' ? new Date(date1) : date1;
  const d2 = typeof date2 === 'string' ? new Date(date2) : date2;
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return null;
  return Math.round((d1.getTime() - d2.getTime()) / minMs);
}

// Extract time components from ISO string
function extractTimeComponents(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return null;
  const hourLocal = parseInt(d.toLocaleString('en-US', { timeZone: 'Pacific/Honolulu', hour: '2-digit', hour12: false }), 10);
  return {
    hour: d.getUTCHours(),
    hourLocal: hourLocal,
    dayOfWeek: d.getUTCDay(), // 0=Sunday, 6=Saturday
    dayName: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()],
  };
}

// Format hour in HST with readable format
function formatHourHST(hour) {
  if (hour === null || hour === undefined) return 'Unknown';
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
  return `${displayHour}:00 ${period} HST`;
}

function percentiles(arr, ps = [0.1, 0.25, 0.5, 0.75, 0.9]) {
  if (!arr.length) return {};
  const sorted = [...arr].sort((a, b) => a - b);
  const out = {};
  for (const p of ps) {
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))));
    out[p] = sorted[idx];
  }
  return out;
}

function analyze7DayAvailability() {
  const perLocFiles = loadPerLocationHistories();
  const historyData = readJsonSafe(HISTORY_FILE, { locations: {}, overall: { changes: [] } });
  
  // Track all events: when dates first appear within 7 days
  const events = [];
  // Track date availability: map of location -> date -> { firstSeen, lastSeen, daysOutAtFirstSeen }
  const dateAvailability = {};
  // Track snapshots chronologically for persistence analysis
  const chronologicalSnapshots = [];

  // Process each location's month history
  for (const { data } of perLocFiles) {
    const location = data.location || 'Unknown';
    const months = data.months || {};
    
    if (!dateAvailability[location]) {
      dateAvailability[location] = {};
    }

    // Process each month snapshot in chronological order
    const monthKeys = Object.keys(months).sort();
    
    for (const monthKey of monthKeys) {
      const month = months[monthKey];
      const capturedAt = month.capturedAt;
      if (!capturedAt) continue;
      
      const captureDate = new Date(capturedAt);
      if (Number.isNaN(captureDate.getTime())) continue;
      
      const byDate = month.byDate || {};
      const timeComponents = extractTimeComponents(capturedAt);
      
      // Track snapshot for chronological analysis
      chronologicalSnapshots.push({
        location,
        capturedAt,
        byDate,
        timeComponents,
      });
      
      // Check each date in this snapshot
      for (const [dateStr, timeSlots] of Object.entries(byDate)) {
        if (!timeSlots || !Array.isArray(timeSlots) || timeSlots.length === 0) continue;
        
        const appointmentDate = new Date(dateStr + 'T00:00:00Z');
        if (Number.isNaN(appointmentDate.getTime())) continue;
        
        const daysOut = daysBetween(appointmentDate, captureDate);
        if (daysOut === null || daysOut < 0) continue; // Skip past dates
        
        // Track when this date first appears within 7 days
        if (daysOut <= 7) {
          if (!dateAvailability[location][dateStr]) {
            // First time seeing this date within 7 days
            dateAvailability[location][dateStr] = {
              firstSeen: capturedAt,
              firstSeenDaysOut: daysOut,
              lastSeen: capturedAt,
              lastSeenDaysOut: daysOut,
              slotCounts: [],
              captureHistory: [],
              minSlotCount: timeSlots.length,
              maxSlotCount: timeSlots.length,
            };
            
            events.push({
              type: 'appeared',
              location,
              date: dateStr,
              capturedAt,
              daysOut,
              slotCount: timeSlots.length,
              timeComponents,
            });
          } else {
            // Update last seen
            const existing = dateAvailability[location][dateStr];
            existing.lastSeen = capturedAt;
            existing.lastSeenDaysOut = daysOut;
            existing.minSlotCount = Math.min(existing.minSlotCount, timeSlots.length);
            existing.maxSlotCount = Math.max(existing.maxSlotCount, timeSlots.length);
          }
          
          // Track slot counts and capture history
          const dateData = dateAvailability[location][dateStr];
          dateData.slotCounts.push({ capturedAt, count: timeSlots.length, daysOut });
          dateData.captureHistory.push({ capturedAt, daysOut, timeSlots });
        }
      }
    }
  }

  // Sort snapshots chronologically
  chronologicalSnapshots.sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());

  // 1. AVAILABILITY PERSISTENCE: Check if appointments are still available on next check
  const persistenceData = {
    stillAvailable: 0,
    disappeared: 0,
    slotCountIncrease: 0,
    slotCountDecrease: 0,
    slotCountSame: 0,
    disappearanceTimes: [], // Minutes until disappearance
  };

  // Track dates that appeared within 7 days and check persistence
  for (let i = 0; i < chronologicalSnapshots.length - 1; i++) {
    const current = chronologicalSnapshots[i];
    const next = chronologicalSnapshots[i + 1];
    
    // Only check if same location
    if (current.location !== next.location) continue;
    
    // Only check dates within 7 days in current snapshot
    const currentCaptureDate = new Date(current.capturedAt);
    const nextCaptureDate = new Date(next.capturedAt);
    const minutesDiff = minutesBetween(next.capturedAt, current.capturedAt);
    
    // Skip if snapshots are too far apart (likely different sessions)
    if (minutesDiff > 30) continue;
    
    for (const [dateStr, timeSlots] of Object.entries(current.byDate || {})) {
      if (!timeSlots || !Array.isArray(timeSlots)) continue;
      
      const appointmentDate = new Date(dateStr + 'T00:00:00Z');
      if (Number.isNaN(appointmentDate.getTime())) continue;
      
      const daysOut = daysBetween(appointmentDate, currentCaptureDate);
      if (daysOut === null || daysOut <= 0 || daysOut > 7) continue;
      
      // Check if this date exists in next snapshot
      const nextDateSlots = next.byDate[dateStr];
      
      if (nextDateSlots && Array.isArray(nextDateSlots) && nextDateSlots.length > 0) {
        persistenceData.stillAvailable++;
        
        // Track slot count changes
        if (nextDateSlots.length > timeSlots.length) {
          persistenceData.slotCountIncrease++;
        } else if (nextDateSlots.length < timeSlots.length) {
          persistenceData.slotCountDecrease++;
          persistenceData.disappeared++; // Some slots disappeared
        } else {
          persistenceData.slotCountSame++;
        }
      } else {
        // Date disappeared entirely
        persistenceData.disappeared++;
        if (minutesDiff > 0) {
          persistenceData.disappearanceTimes.push(minutesDiff);
        }
      }
    }
  }

  // 2. SLOT COUNT TRENDS: When appointments appear within 7 days, how many slots typically available?
  const slotCountsOnAppearance = [];
  const slotCountsByLocation = {};
  const slotCountsByDaysOut = {};
  
  for (const event of events) {
    if (event.type === 'appeared' || event.type === 'appeared_from_changes') {
      // Change history events might not have slot counts, only snapshot events do
      if (event.slotCount !== undefined) {
        slotCountsOnAppearance.push(event.slotCount);
        
        if (!slotCountsByLocation[event.location]) {
          slotCountsByLocation[event.location] = [];
        }
        slotCountsByLocation[event.location].push(event.slotCount);
        
        const daysOutBucket = Math.floor(event.daysOut / 2) * 2;
        if (!slotCountsByDaysOut[daysOutBucket]) {
          slotCountsByDaysOut[daysOutBucket] = [];
        }
        slotCountsByDaysOut[daysOutBucket].push(event.slotCount);
      }
    }
  }

  // 3. MULTI-DATE AVAILABILITY: When short-notice appointments appear, how often multiple dates appear simultaneously?
  const multiDateEvents = [];
  
  for (let i = 0; i < chronologicalSnapshots.length; i++) {
    const snapshot = chronologicalSnapshots[i];
    const captureDate = new Date(snapshot.capturedAt);
    
    const datesWithin7Days = [];
    for (const [dateStr, timeSlots] of Object.entries(snapshot.byDate || {})) {
      if (!timeSlots || !Array.isArray(timeSlots) || timeSlots.length === 0) continue;
      
      const appointmentDate = new Date(dateStr + 'T00:00:00Z');
      if (Number.isNaN(appointmentDate.getTime())) continue;
      
      const daysOut = daysBetween(appointmentDate, captureDate);
      if (daysOut !== null && daysOut >= 0 && daysOut <= 7) {
        datesWithin7Days.push({ date: dateStr, daysOut, slotCount: timeSlots.length });
      }
    }
    
    if (datesWithin7Days.length > 0) {
      multiDateEvents.push({
        location: snapshot.location,
        capturedAt: snapshot.capturedAt,
        dateCount: datesWithin7Days.length,
        totalSlots: datesWithin7Days.reduce((sum, d) => sum + d.slotCount, 0),
        dates: datesWithin7Days,
        timeComponents: snapshot.timeComponents,
      });
    }
  }

  // 4A. APPOINTMENTS WITHIN 7 DAYS FROM CHANGE HISTORY (dmv-history.json)
  // This captures same-day and short-lived appointments that month snapshots might miss
  const changeHistory7DayEvents = [];
  const changeHistoryDurations = [];
  
  for (const [location, locData] of Object.entries(historyData.locations || {})) {
    const changes = locData.changes || [];
    
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      if (!change.toDataVal || !change.changedAt) continue;
      
      // Parse the appointment date from toDataVal
      const apptDateTime = parseDataVal(change.toDataVal);
      if (!apptDateTime) continue;
      
      const changeTime = new Date(change.changedAt);
      if (Number.isNaN(changeTime.getTime())) continue;
      
      // Calculate days out when this appointment appeared
      const daysOut = daysBetween(apptDateTime, changeTime);
      if (daysOut === null || daysOut < 0 || daysOut > 7) continue; // Only within 7 days
      
      // Find when this appointment disappeared (next change)
      let disappearedAt = null;
      for (let j = i + 1; j < changes.length; j++) {
        const nextChange = changes[j];
        // If the next change has a different date, this one disappeared
        if (nextChange.toDataVal) {
          const nextApptDateTime = parseDataVal(nextChange.toDataVal);
          if (nextApptDateTime && nextApptDateTime.getTime() !== apptDateTime.getTime()) {
            disappearedAt = new Date(nextChange.changedAt);
            break;
          }
        }
      }
      
      // If never disappeared in history, it might still be available
      const timeComponents = extractTimeComponents(change.changedAt);
      
      changeHistory7DayEvents.push({
        type: 'appeared_from_changes',
        location,
        date: apptDateTime.toISOString().split('T')[0],
        dataVal: change.toDataVal,
        appearedAt: change.changedAt,
        disappearedAt: disappearedAt ? disappearedAt.toISOString() : null,
        daysOut,
        timeComponents,
      });
      
      // Calculate duration if we know when it disappeared
      if (disappearedAt && !Number.isNaN(disappearedAt.getTime())) {
        const durationMs = disappearedAt.getTime() - changeTime.getTime();
        const durationMinutes = durationMs / minMs;
        const durationHours = durationMs / hourMs;
        
        if (durationMinutes > 0) {
          changeHistoryDurations.push(durationHours);
        }
      }
    }
  }

  // Merge change history events with snapshot events for complete picture
  for (const event of changeHistory7DayEvents) {
    events.push(event);
  }

  // 4B. CANCELLATION TIMING PATTERNS: Analyze changes from dmv-history.json
  const cancellationPatterns = {
    byHour: {},
    byDayOfWeek: {},
    byLocation: {},
    deltaDays: [],
    cancellationCount: 0,
    soonerCount: 0,
  };

  for (const [location, locData] of Object.entries(historyData.locations || {})) {
    const changes = locData.changes || [];
    
    for (const change of changes) {
      // Track "sooner" direction changes (likely cancellations creating openings)
      if (change.direction === 'sooner' && change.deltaDays !== null && change.deltaDays < 0) {
        cancellationPatterns.soonerCount++;
        
        const timeComponents = extractTimeComponents(change.changedAt);
        
        if (timeComponents) {
          const hourLocal = timeComponents.hourLocal;
          const dowName = timeComponents.dayName;
          
          if (hourLocal >= 0) {
            cancellationPatterns.byHour[hourLocal] = (cancellationPatterns.byHour[hourLocal] || 0) + 1;
          }
          cancellationPatterns.byDayOfWeek[dowName] = (cancellationPatterns.byDayOfWeek[dowName] || 0) + 1;
        }
        
        cancellationPatterns.byLocation[location] = (cancellationPatterns.byLocation[location] || 0) + 1;
        
        if (Number.isFinite(change.deltaDays)) {
          cancellationPatterns.deltaDays.push(Math.abs(change.deltaDays));
        }
      }
      
      // Track cancellations (when an earlier appointment appears, it might be a cancellation)
      if (change.direction === 'sooner' && change.deltaDays !== null && change.deltaDays < -1) {
        cancellationPatterns.cancellationCount++;
      }
    }
  }

  // 5. LEAD TIME TRENDS: Are appointments getting closer or further out over time?
  const leadTimeData = [];
  
  // Extract earliest available appointment from each snapshot
  for (const snapshot of chronologicalSnapshots) {
    const captureDate = new Date(snapshot.capturedAt);
    let earliestDaysOut = null;
    
    for (const [dateStr] of Object.entries(snapshot.byDate || {})) {
      const appointmentDate = new Date(dateStr + 'T00:00:00Z');
      if (Number.isNaN(appointmentDate.getTime())) continue;
      
      const daysOut = daysBetween(appointmentDate, captureDate);
      if (daysOut !== null && daysOut >= 0) {
        if (earliestDaysOut === null || daysOut < earliestDaysOut) {
          earliestDaysOut = daysOut;
        }
      }
    }
    
    if (earliestDaysOut !== null) {
      leadTimeData.push({
        location: snapshot.location,
        capturedAt: snapshot.capturedAt,
        earliestDaysOut,
        timeComponents: snapshot.timeComponents,
      });
    }
  }

  // Calculate durations for appointments that appeared within 7 days
  const durations = [];
  const durationsByLocation = {};
  const durationsByDaysOut = {};
  
  // Add durations from month history snapshots
  for (const [location, dates] of Object.entries(dateAvailability)) {
    if (!durationsByLocation[location]) {
      durationsByLocation[location] = [];
    }
    
    for (const [dateStr, data] of Object.entries(dates)) {
      // Only consider dates that first appeared within 7 days
      if (data.firstSeenDaysOut > 7) continue;
      
      const firstSeenDate = new Date(data.firstSeen);
      const lastSeenDate = new Date(data.lastSeen);
      
      if (Number.isNaN(firstSeenDate.getTime()) || Number.isNaN(lastSeenDate.getTime())) continue;
      
      const durationMs = lastSeenDate.getTime() - firstSeenDate.getTime();
      const durationHours = durationMs / hourMs;
      const durationDays = durationMs / dayMs;
      
      // Track overall durations
      durations.push(durationHours);
      durationsByLocation[location].push(durationHours);
      
      // Group by days-out when first seen (0-1, 2-3, 4-5, 6-7)
      const daysOutBucket = Math.floor(data.firstSeenDaysOut / 2) * 2;
      if (!durationsByDaysOut[daysOutBucket]) {
        durationsByDaysOut[daysOutBucket] = [];
      }
      durationsByDaysOut[daysOutBucket].push(durationHours);
    }
  }
  
  // Add durations from change history (captures same-day and short-lived appointments)
  for (const durationHours of changeHistoryDurations) {
    durations.push(durationHours);
  }

  // Analyze frequency patterns
  const frequencyByHour = {};
  const frequencyByDayOfWeek = {};
  const frequencyByLocation = {};
  
  for (const event of events) {
    if (event.type === 'appeared' || event.type === 'appeared_from_changes') {
      // By hour (HST for display)
      const hourLocal = event.timeComponents?.hourLocal ?? -1;
      if (hourLocal >= 0) {
        frequencyByHour[hourLocal] = (frequencyByHour[hourLocal] || 0) + 1;
      }
      
      // By day of week
      const dow = event.timeComponents?.dayOfWeek ?? -1;
      const dowName = event.timeComponents?.dayName || 'Unknown';
      frequencyByDayOfWeek[dowName] = (frequencyByDayOfWeek[dowName] || 0) + 1;
      
      // By location
      frequencyByLocation[event.location] = (frequencyByLocation[event.location] || 0) + 1;
    }
  }

  // Calculate statistics
  const durationStats = durations.length > 0 ? {
    count: durations.length,
    min: Math.min(...durations),
    max: Math.max(...durations),
    ...percentiles(durations, [0.1, 0.25, 0.5, 0.75, 0.9]),
    mean: durations.reduce((a, b) => a + b, 0) / durations.length,
  } : null;

  // 6. COMPETITION INDICATORS: How quickly do appointments disappear?
  const competitionStats = persistenceData.disappearanceTimes.length > 0 ? {
    count: persistenceData.disappearanceTimes.length,
    min: Math.min(...persistenceData.disappearanceTimes),
    max: Math.max(...persistenceData.disappearanceTimes),
    ...percentiles(persistenceData.disappearanceTimes, [0.1, 0.5, 0.9]),
    mean: persistenceData.disappearanceTimes.reduce((a, b) => a + b, 0) / persistenceData.disappearanceTimes.length,
  } : null;

  // Response time analysis
  const responseTimeNeeded = durationStats ? {
    p10: durationStats[0.1] || 0,
    median: durationStats[0.5] || 0,
    mean: durationStats.mean || 0,
  } : null;

  // Slot count statistics
  const slotCountStats = slotCountsOnAppearance.length > 0 ? {
    count: slotCountsOnAppearance.length,
    min: Math.min(...slotCountsOnAppearance),
    max: Math.max(...slotCountsOnAppearance),
    ...percentiles(slotCountsOnAppearance, [0.5, 0.9]),
    mean: slotCountsOnAppearance.reduce((a, b) => a + b, 0) / slotCountsOnAppearance.length,
  } : null;

  // Multi-date statistics
  const multiDateStats = multiDateEvents.length > 0 ? {
    singleDate: multiDateEvents.filter(e => e.dateCount === 1).length,
    multipleDates: multiDateEvents.filter(e => e.dateCount > 1).length,
    avgDatesPerEvent: multiDateEvents.reduce((sum, e) => sum + e.dateCount, 0) / multiDateEvents.length,
    avgSlotsPerEvent: multiDateEvents.reduce((sum, e) => sum + e.totalSlots, 0) / multiDateEvents.length,
    maxDatesInEvent: Math.max(...multiDateEvents.map(e => e.dateCount)),
  } : null;

  // Lead time trend analysis (simple linear regression approximation)
  let leadTimeTrend = null;
  if (leadTimeData.length > 10) {
    // Group by time period (weekly) to see trends
    const weeklyAverages = {};
    for (const data of leadTimeData) {
      const d = new Date(data.capturedAt);
      const weekKey = `${d.getUTCFullYear()}-W${Math.floor(d.getUTCDay() / 7)}`;
      if (!weeklyAverages[weekKey]) {
        weeklyAverages[weekKey] = [];
      }
      weeklyAverages[weekKey].push(data.earliestDaysOut);
    }
    
    const weeks = Object.keys(weeklyAverages).sort();
    const weekAvgs = weeks.map(w => {
      const values = weeklyAverages[w];
      return values.reduce((a, b) => a + b, 0) / values.length;
    });
    
    // Simple trend: compare first half vs second half
    if (weekAvgs.length >= 4) {
      const firstHalf = weekAvgs.slice(0, Math.floor(weekAvgs.length / 2));
      const secondHalf = weekAvgs.slice(Math.floor(weekAvgs.length / 2));
      const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
      leadTimeTrend = {
        firstHalfAvg: firstAvg,
        secondHalfAvg: secondAvg,
        trend: secondAvg < firstAvg ? 'getting_closer' : secondAvg > firstAvg ? 'getting_further' : 'stable',
        change: secondAvg - firstAvg,
      };
    }
  }

  // Build report
  const textLines = [];
  const htmlLines = [];

  textLines.push('7-Day Appointment Availability Analysis');
  textLines.push('========================================');
  htmlLines.push('<h2>7-Day Appointment Availability Analysis</h2>');

  // Metrics explanation
  textLines.push('\nMetrics Explanation:');
  textLines.push('-------------------');
  textLines.push('This analysis tracks appointments that become available within 7 days.');
  textLines.push('Data sources: Month history snapshots + Change history (captures same-day/short-lived appointments).');
  textLines.push('');
  textLines.push('Key Metrics:');
  textLines.push('  1. Availability Persistence: Percentage of appointments still available');
  textLines.push('     on the next check (5-30 min later). Higher = better chance to book.');
  textLines.push('     >80% = Very stable, 60-80% = Moderate, <60% = Highly competitive.');
  textLines.push('');
  textLines.push('  2. Slot Count Trends: How many appointment slots appear at once when');
  textLines.push('     openings become available. More slots = better booking opportunity.');
  textLines.push('     Average >5 = Good, 3-5 = Moderate, <3 = Limited availability.');
  textLines.push('');
  textLines.push('  3. Multi-Date Availability: When appointments appear within 7 days, how');
  textLines.push('     often multiple dates appear at the same time. Higher % = more options.');
  textLines.push('');
  textLines.push('  4. Cancellation Timing: Peak hours when cancellations occur (creating');
  textLines.push('     openings). Useful for timing checks when new appointments are likely.');
  textLines.push('');
  textLines.push('  5. Lead Time Trends: Whether appointments are getting closer (better) or');
  textLines.push('     further out (worse) over time. Shows overall availability trends.');
  textLines.push('');
  textLines.push('  6. Competition Indicators: How quickly appointments disappear after');
  textLines.push('     appearing. Faster = more competition. <30 min = HIGH, 30-120 min =');
  textLines.push('     MODERATE, >120 min = LOW competition.');
  textLines.push('');
  textLines.push('  7. Duration Statistics: How long appointments stay available once they');
  textLines.push('     appear within 7 days. Longer durations = more time to book.');
  textLines.push('     <1 hour = Very competitive, 1-6 hours = Competitive, >6 hours = Less competitive.');
  textLines.push('');
  
  htmlLines.push('<div style="background: #f0f0f0; padding: 15px; margin: 15px 0; border-left: 4px solid #007acc;">');
  htmlLines.push('<h3>Metrics Explanation</h3>');
  htmlLines.push('<p>This analysis tracks appointments that become available within 7 days.</p>');
  htmlLines.push('<h4>Key Metrics:</h4>');
  htmlLines.push('<ol>');
  htmlLines.push('<li><strong>Availability Persistence:</strong> Percentage of appointments still available on the next check (5-30 min later). Higher = better chance to book.<br>');
  htmlLines.push('<strong>Interpretation:</strong> &gt;80% = Very stable, 60-80% = Moderate, &lt;60% = Highly competitive.</li>');
  htmlLines.push('<li><strong>Slot Count Trends:</strong> How many appointment slots appear at once when openings become available. More slots = better booking opportunity.<br>');
  htmlLines.push('<strong>Interpretation:</strong> Average &gt;5 = Good, 3-5 = Moderate, &lt;3 = Limited availability.</li>');
  htmlLines.push('<li><strong>Multi-Date Availability:</strong> When appointments appear within 7 days, how often multiple dates appear at the same time. Higher % = more options.</li>');
  htmlLines.push('<li><strong>Cancellation Timing:</strong> Peak hours when cancellations occur (creating openings). Useful for timing checks when new appointments are likely.</li>');
  htmlLines.push('<li><strong>Lead Time Trends:</strong> Whether appointments are getting closer (better) or further out (worse) over time. Shows overall availability trends.</li>');
  htmlLines.push('<li><strong>Competition Indicators:</strong> How quickly appointments disappear after appearing. Faster = more competition.<br>');
  htmlLines.push('<strong>Interpretation:</strong> &lt;30 min = HIGH, 30-120 min = MODERATE, &gt;120 min = LOW competition.</li>');
  htmlLines.push('<li><strong>Duration Statistics:</strong> How long appointments stay available once they appear within 7 days. Longer durations = more time to book.<br>');
  htmlLines.push('<strong>Interpretation:</strong> &lt;1 hour = Very competitive, 1-6 hours = Competitive, &gt;6 hours = Less competitive.</li>');
  htmlLines.push('</ol>');
  htmlLines.push('</div>');

  // Summary statistics
  textLines.push('\nSummary:');
  htmlLines.push('<h3>Summary</h3>');
  
  const totalEvents = events.filter(e => e.type === 'appeared' || e.type === 'appeared_from_changes').length;
  const snapshotEvents = events.filter(e => e.type === 'appeared').length;
  const changeHistoryEvents = events.filter(e => e.type === 'appeared_from_changes').length;
  
  textLines.push(`  Total instances where appointments appeared within 7 days: ${totalEvents}`);
  if (changeHistoryEvents > 0) {
    textLines.push(`    - From month history snapshots: ${snapshotEvents}`);
    textLines.push(`    - From change history (same-day/short-lived): ${changeHistoryEvents}`);
  }
  
  htmlLines.push(`<p><strong>Total instances where appointments appeared within 7 days:</strong> ${totalEvents}</p>`);
  if (changeHistoryEvents > 0) {
    htmlLines.push(`<p><em>Breakdown:</em> ${snapshotEvents} from month snapshots, ${changeHistoryEvents} from change history (captures same-day/short-lived appointments)</p>`);
  }
  
  if (durationStats) {
    const formatDuration = (hours) => {
      if (hours < 1) return `${(hours * 60).toFixed(0)} minutes`;
      if (hours < 24) return `${hours.toFixed(1)} hours`;
      const days = hours / 24;
      return `${days.toFixed(1)} days (${hours.toFixed(1)} hours)`;
    };
    
    textLines.push(`  Dates tracked: ${durationStats.count}`);
    textLines.push(`  Average duration available: ${formatDuration(durationStats.mean)}`);
    textLines.push(`  Median duration: ${formatDuration(durationStats[0.5])}`);
    textLines.push(`  Minimum duration: ${formatDuration(durationStats.min)}`);
    textLines.push(`  Maximum duration: ${formatDuration(durationStats.max)}`);
    
    htmlLines.push(`<ul>`);
    htmlLines.push(`<li><strong>Dates tracked:</strong> ${durationStats.count}</li>`);
    htmlLines.push(`<li><strong>Average duration available:</strong> ${formatDuration(durationStats.mean)}</li>`);
    htmlLines.push(`<li><strong>Median duration:</strong> ${formatDuration(durationStats[0.5])}</li>`);
    htmlLines.push(`<li><strong>Minimum duration:</strong> ${formatDuration(durationStats.min)}</li>`);
    htmlLines.push(`<li><strong>Maximum duration:</strong> ${formatDuration(durationStats.max)}</li>`);
    htmlLines.push(`</ul>`);
  }

  // 1. AVAILABILITY PERSISTENCE
  textLines.push('\n1. Availability Persistence:');
  htmlLines.push(`<h3>1. Availability Persistence</h3>`);
  
  const totalPersistenceChecks = persistenceData.stillAvailable + persistenceData.disappeared;
  if (totalPersistenceChecks > 0) {
    const persistenceRate = (persistenceData.stillAvailable / totalPersistenceChecks * 100).toFixed(1);
    textLines.push(`  Appointments still available on next check (5-30 min): ${persistenceData.stillAvailable} / ${totalPersistenceChecks} (${persistenceRate}%)`);
    textLines.push(`  Appointments disappeared: ${persistenceData.disappeared} / ${totalPersistenceChecks} (${(100 - parseFloat(persistenceRate)).toFixed(1)}%)`);
    textLines.push(`  Slot count increases: ${persistenceData.slotCountIncrease}, decreases: ${persistenceData.slotCountDecrease}, same: ${persistenceData.slotCountSame}`);
    
    htmlLines.push(`<ul>`);
    htmlLines.push(`<li><strong>Still available on next check:</strong> ${persistenceData.stillAvailable} / ${totalPersistenceChecks} (${persistenceRate}%)</li>`);
    htmlLines.push(`<li><strong>Disappeared:</strong> ${persistenceData.disappeared} / ${totalPersistenceChecks} (${(100 - parseFloat(persistenceRate)).toFixed(1)}%)</li>`);
    htmlLines.push(`<li><strong>Slot changes:</strong> +${persistenceData.slotCountIncrease}, -${persistenceData.slotCountDecrease}, =${persistenceData.slotCountSame}</li>`);
    htmlLines.push(`</ul>`);
  }

  // 2. SLOT COUNT TRENDS
  textLines.push('\n2. Slot Count Trends (on appearance within 7 days):');
  htmlLines.push(`<h3>2. Slot Count Trends (on appearance within 7 days)</h3>`);
  
  if (slotCountStats) {
    textLines.push(`  Average slots when appearing: ${slotCountStats.mean.toFixed(1)}`);
    textLines.push(`  Median: ${slotCountStats[0.5].toFixed(1)}, p90: ${slotCountStats[0.9].toFixed(1)}`);
    textLines.push(`  Range: ${slotCountStats.min} - ${slotCountStats.max} slots`);
    
    htmlLines.push(`<ul>`);
    htmlLines.push(`<li><strong>Average slots when appearing:</strong> ${slotCountStats.mean.toFixed(1)}</li>`);
    htmlLines.push(`<li><strong>Median:</strong> ${slotCountStats[0.5].toFixed(1)}, <strong>p90:</strong> ${slotCountStats[0.9].toFixed(1)}</li>`);
    htmlLines.push(`<li><strong>Range:</strong> ${slotCountStats.min} - ${slotCountStats.max} slots</li>`);
    htmlLines.push(`</ul>`);
  }

  // 3. MULTI-DATE AVAILABILITY
  textLines.push('\n3. Multi-Date Availability:');
  htmlLines.push(`<h3>3. Multi-Date Availability</h3>`);
  
  if (multiDateStats) {
    const multiDateRate = multiDateStats.multipleDates / (multiDateStats.singleDate + multiDateStats.multipleDates) * 100;
    textLines.push(`  Single date events: ${multiDateStats.singleDate}`);
    textLines.push(`  Multiple date events: ${multiDateStats.multipleDates} (${multiDateRate.toFixed(1)}%)`);
    textLines.push(`  Average dates per event: ${multiDateStats.avgDatesPerEvent.toFixed(1)}`);
    textLines.push(`  Average slots per event: ${multiDateStats.avgSlotsPerEvent.toFixed(1)}`);
    textLines.push(`  Maximum dates in single event: ${multiDateStats.maxDatesInEvent}`);
    
    htmlLines.push(`<ul>`);
    htmlLines.push(`<li><strong>Single date events:</strong> ${multiDateStats.singleDate}</li>`);
    htmlLines.push(`<li><strong>Multiple date events:</strong> ${multiDateStats.multipleDates} (${multiDateRate.toFixed(1)}%)</li>`);
    htmlLines.push(`<li><strong>Average dates per event:</strong> ${multiDateStats.avgDatesPerEvent.toFixed(1)}</li>`);
    htmlLines.push(`<li><strong>Average slots per event:</strong> ${multiDateStats.avgSlotsPerEvent.toFixed(1)}</li>`);
    htmlLines.push(`<li><strong>Maximum dates in single event:</strong> ${multiDateStats.maxDatesInEvent}</li>`);
    htmlLines.push(`</ul>`);
  }

  // 4. CANCELLATION TIMING PATTERNS
  textLines.push('\n4. Cancellation Timing Patterns (from change history):');
  htmlLines.push(`<h3>4. Cancellation Timing Patterns (from change history)</h3>`);
  
  textLines.push(`  Total "sooner" changes: ${cancellationPatterns.soonerCount}`);
  textLines.push(`  Cancellations detected (deltaDays < -1): ${cancellationPatterns.cancellationCount}`);
  
  if (cancellationPatterns.deltaDays.length > 0) {
    const avgDelta = cancellationPatterns.deltaDays.reduce((a, b) => a + b, 0) / cancellationPatterns.deltaDays.length;
    textLines.push(`  Average days improvement when cancellation occurs: ${avgDelta.toFixed(1)} days`);
    htmlLines.push(`<ul>`);
    htmlLines.push(`<li><strong>Total "sooner" changes:</strong> ${cancellationPatterns.soonerCount}</li>`);
    htmlLines.push(`<li><strong>Cancellations detected:</strong> ${cancellationPatterns.cancellationCount}</li>`);
    htmlLines.push(`<li><strong>Average days improvement:</strong> ${avgDelta.toFixed(1)} days</li>`);
    htmlLines.push(`</ul>`);
  }

  // Top cancellation hours
  const topCancellationHours = Object.entries(cancellationPatterns.byHour)
    .map(([h, c]) => [Number(h), c])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  
  if (topCancellationHours.length > 0) {
    const hourDisplayList = topCancellationHours.map(([h, c]) => `${formatHourHST(h)} (${c})`).join(', ');
    textLines.push(`  Peak cancellation hours (HST): ${hourDisplayList}`);
    htmlLines.push(`<p><strong>Peak cancellation hours (HST):</strong> ${hourDisplayList}</p>`);
  }

  // 5. LEAD TIME TRENDS
  textLines.push('\n5. Lead Time Trends:');
  htmlLines.push(`<h3>5. Lead Time Trends</h3>`);
  
  if (leadTimeTrend) {
    textLines.push(`  Trend: Appointments are ${leadTimeTrend.trend === 'getting_closer' ? 'getting CLOSER' : leadTimeTrend.trend === 'getting_further' ? 'getting FURTHER OUT' : 'STABLE'}`);
    textLines.push(`  First half average: ${leadTimeTrend.firstHalfAvg.toFixed(1)} days out`);
    textLines.push(`  Second half average: ${leadTimeTrend.secondHalfAvg.toFixed(1)} days out`);
    textLines.push(`  Change: ${leadTimeTrend.change > 0 ? '+' : ''}${leadTimeTrend.change.toFixed(1)} days`);
    
    htmlLines.push(`<ul>`);
    htmlLines.push(`<li><strong>Trend:</strong> Appointments are <strong>${leadTimeTrend.trend === 'getting_closer' ? 'getting CLOSER' : leadTimeTrend.trend === 'getting_further' ? 'getting FURTHER OUT' : 'STABLE'}</strong></li>`);
    htmlLines.push(`<li><strong>First half average:</strong> ${leadTimeTrend.firstHalfAvg.toFixed(1)} days out</li>`);
    htmlLines.push(`<li><strong>Second half average:</strong> ${leadTimeTrend.secondHalfAvg.toFixed(1)} days out</li>`);
    htmlLines.push(`<li><strong>Change:</strong> ${leadTimeTrend.change > 0 ? '+' : ''}${leadTimeTrend.change.toFixed(1)} days</li>`);
    htmlLines.push(`</ul>`);
  }

  // 6. COMPETITION INDICATORS
  textLines.push('\n6. Competition Indicators (disappearance speed):');
  htmlLines.push(`<h3>6. Competition Indicators (disappearance speed)</h3>`);
  
  if (competitionStats) {
    const formatMinutes = (mins) => {
      if (mins < 60) return `${mins.toFixed(0)} minutes`;
      const hours = mins / 60;
      if (hours < 24) return `${hours.toFixed(1)} hours (${mins.toFixed(0)} min)`;
      const days = hours / 24;
      return `${days.toFixed(1)} days (${hours.toFixed(1)} hours)`;
    };
    
    textLines.push(`  Fastest disappearances: ${formatMinutes(competitionStats.min)} (p10: ${formatMinutes(competitionStats[0.1])})`);
    textLines.push(`  Median disappearance time: ${formatMinutes(competitionStats[0.5])}`);
    textLines.push(`  Average: ${formatMinutes(competitionStats.mean)}`);
    textLines.push(`  Slowest: ${formatMinutes(competitionStats.max)}`);
    
    htmlLines.push(`<ul>`);
    htmlLines.push(`<li><strong>Fastest disappearances:</strong> ${formatMinutes(competitionStats.min)} (p10: ${formatMinutes(competitionStats[0.1])})</li>`);
    htmlLines.push(`<li><strong>Median disappearance time:</strong> ${formatMinutes(competitionStats[0.5])}</li>`);
    htmlLines.push(`<li><strong>Average:</strong> ${formatMinutes(competitionStats.mean)}</li>`);
    htmlLines.push(`<li><strong>Slowest:</strong> ${formatMinutes(competitionStats.max)}</li>`);
    htmlLines.push(`</ul>`);
  }

  // Response time guidance
  if (responseTimeNeeded) {
    const formatResponseTime = (hours) => {
      if (hours < 1) return `${Math.round(hours * 60)} minutes`;
      if (hours < 24) return `${hours.toFixed(1)} hours`;
      return `${(hours / 24).toFixed(1)} days (${hours.toFixed(1)} hours)`;
    };
    
    textLines.push('\n  Response Time Guidance:');
    const recHours = Math.max(0.5, responseTimeNeeded.p10);
    textLines.push(`    Recommendation: System should respond within ${formatResponseTime(recHours)} for best results`);
    htmlLines.push(`<h4>Response Time Guidance</h4>`);
    htmlLines.push(`<p><strong>Recommendation:</strong> System should respond within ${formatResponseTime(recHours)} for best results</p>`);
  }

  // Frequency by location
  textLines.push('\n  Frequency by Location:');
  htmlLines.push(`<h3>Frequency by Location</h3>`);
  const locationEntries = Object.entries(frequencyByLocation)
    .sort((a, b) => b[1] - a[1])
    .map(([loc, count]) => {
      const dispLoc = displayLoc(loc);
      return { loc, dispLoc, count };
    });
  
  for (const { dispLoc, count } of locationEntries) {
    textLines.push(`    ${dispLoc}: ${count} instances`);
    htmlLines.push(`<p>${dispLoc}: <strong>${count}</strong> instances</p>`);
  }

  // Queue system recommendations
  textLines.push('\n  Queue System Recommendations:');
  htmlLines.push(`<h3>Queue System Recommendations</h3>`);
  
  const checkInterval = 5; // Bot checks every 5 minutes
  const recommendedCheckInterval = responseTimeNeeded && responseTimeNeeded.p10 < 2 ? 
    `Keep current ${checkInterval}-minute interval` : 
    `Consider ${Math.max(checkInterval, Math.ceil(responseTimeNeeded?.p10 || 1) * 60)} minute intervals if response time > ${responseTimeNeeded?.p10.toFixed(1)}h`;
  
  const persistenceRate = totalPersistenceChecks > 0 ? (persistenceData.stillAvailable / totalPersistenceChecks * 100).toFixed(1) : 'N/A';
  const competitionLevel = competitionStats && competitionStats[0.1] < 30 ? 'HIGH' : competitionStats && competitionStats[0.1] < 120 ? 'MODERATE' : 'LOW';
  
  textLines.push(`    1. Check frequency: ${recommendedCheckInterval}`);
  textLines.push(`    2. Availability persistence: ${persistenceRate}% of appointments still available on next check`);
  textLines.push(`    3. Competition level: ${competitionLevel} (based on disappearance speed)`);
  textLines.push(`    4. Priority times: Focus checks during peak cancellation hours`);
  textLines.push(`    5. Multi-date strategy: ${multiDateStats && multiDateStats.multipleDates > 0 ? `${(multiDateStats.multipleDates / (multiDateStats.singleDate + multiDateStats.multipleDates) * 100).toFixed(1)}% of events have multiple dates` : 'Most events have single dates'}`);
  textLines.push(`    6. Alert threshold: Consider alerting on appointments <= ${responseTimeNeeded ? Math.max(1, Math.ceil(responseTimeNeeded.p10 / 24)) : 7} days out`);
  
  htmlLines.push(`<ul>`);
  htmlLines.push(`<li><strong>Check frequency:</strong> ${recommendedCheckInterval}</li>`);
  htmlLines.push(`<li><strong>Availability persistence:</strong> ${persistenceRate}% of appointments still available on next check</li>`);
  htmlLines.push(`<li><strong>Competition level:</strong> ${competitionLevel} (based on disappearance speed)</li>`);
  htmlLines.push(`<li><strong>Priority times:</strong> Focus checks during peak cancellation hours</li>`);
  htmlLines.push(`<li><strong>Multi-date strategy:</strong> ${multiDateStats && multiDateStats.multipleDates > 0 ? `${(multiDateStats.multipleDates / (multiDateStats.singleDate + multiDateStats.multipleDates) * 100).toFixed(1)}% of events have multiple dates` : 'Most events have single dates'}</li>`);
  htmlLines.push(`<li><strong>Alert threshold:</strong> Consider alerting on appointments <= ${responseTimeNeeded ? Math.max(1, Math.ceil(responseTimeNeeded.p10 / 24)) : 7} days out</li>`);
  htmlLines.push(`</ul>`);

  const textBody = textLines.join('\n');
  const htmlBody = htmlLines.join('\n');

  // Write reports
  try {
    if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(REPORT_DIR, '7day-availability-latest.txt'), textBody, 'utf8');
    fs.writeFileSync(path.join(REPORT_DIR, '7day-availability-latest.html'), htmlBody, 'utf8');
    fs.appendFileSync(path.join(REPORT_DIR, '7day-availability-run-log.txt'), `\n---- ${ts} ----\n${textBody}\n`, 'utf8');
  } catch (e) {
    console.log(`Warning: failed to write report files: ${e && e.message ? e.message : e}`);
  }

  console.log(textBody);

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `availability_7day_text<<EOF\n${textBody}\nEOF\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `availability_7day_html<<EOF\n${htmlBody}\nEOF\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `availability_7day_subject=DMV 7-day availability analysis\n`);
  }
}

analyze7DayAvailability();
