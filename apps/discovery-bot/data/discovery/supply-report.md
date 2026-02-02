# DMV Service Demand Discovery Report

Generated: 2026-02-02T08:06:04.728Z
Duration: 825s
Scanned: 15 locations, 74 service combinations
Success rate: 74/74 (100%)

## Demand Analysis by Service

Services with NO availability in 30 days indicate HIGH DEMAND.

| Service | No 30d | 30-Day | 31-60d | Soonest | Demand |
|---------|--------|--------|--------|---------|--------|
| Instruction Permit Initial | 4/5 | 1 | 0 | 2026-02-02 | 🔴 HIGH |
| Commercial Driver License Services | 0/1 | 323 | 336 | 2026-02-02 | 🟢 OK |
| Disability Parking Permit / Holo Ca | 0/1 | 437 | 651 | 2026-02-10 | 🟢 OK |
| Disability Parking Permits | 0/1 | 534 | 672 | 2026-02-02 | 🟢 OK |
| U.S. Passport | 0/3 | 834 | 551 | 2026-02-02 | 🟢 OK |
| Instruction Permit | 1/5 | 31 | 2741 | 2026-03-02 | 🟠 MED |
| Hawaii License Renewal | 1/5 | 54 | 2741 | 2026-03-02 | 🟠 MED |
| Instruction Permit Duplicate | 1/5 | 54 | 2741 | 2026-03-02 | 🟠 MED |
| Out Of State Transfer | 1/5 | 45 | 2751 | 2026-02-02 | 🟠 MED |
| State ID Duplicate | 1/5 | 45 | 2751 | 2026-02-02 | 🟠 MED |
| Hawaii License Duplicate | 1/5 | 54 | 2751 | 2026-03-02 | 🟠 MED |
| Hawaii Provisional to a Full Licens | 1/5 | 54 | 2751 | 2026-03-02 | 🟠 MED |
| Instruction Permit Renewal | 1/5 | 54 | 2751 | 2026-03-02 | 🟠 MED |
| State ID Initial | 1/5 | 55 | 2751 | 2026-02-02 | 🟠 MED |
| State ID Renewal | 1/5 | 55 | 2751 | 2026-02-02 | 🟠 MED |
| Driver License or State ID Duplicat | 0/4 | 825 | 3107 | 2026-02-18 | 🟢 OK |
| Motor Vehicles & Other Services | 0/9 | 4901 | 6016 | 2026-02-02 | 🟢 OK |

## Recommendations

### 🔴 High Demand - Start Frequent Monitoring
These services have NO or very few appointments available. Users need our queue/booking system.

- **Instruction Permit Initial**: 4/5 locations have NO availability (only 1 total slots found)

### 🟠 Medium Demand - Monitor Weekly
Limited availability. Worth tracking to see if demand increases.

- **Instruction Permit**: 2772 slots across 4 locations
- **Hawaii License Renewal**: 2795 slots across 4 locations
- **Instruction Permit Duplicate**: 2795 slots across 4 locations
- **Out Of State Transfer**: 2796 slots across 4 locations
- **State ID Duplicate**: 2796 slots across 4 locations
- **Hawaii License Duplicate**: 2805 slots across 4 locations
- **Hawaii Provisional to a Full License**: 2805 slots across 4 locations
- **Instruction Permit Renewal**: 2805 slots across 4 locations
- **State ID Initial**: 2806 slots across 4 locations
- **State ID Renewal**: 2806 slots across 4 locations

### 🟢 Available - Low Priority
Plenty of appointments available. Users can self-serve.

- **Commercial Driver License Services**: 659 slots available
- **Disability Parking Permit / Holo Card**: 1088 slots available
- **Disability Parking Permits**: 1206 slots available
- **U.S. Passport**: 1385 slots available
- **Driver License or State ID Duplicates & Instruction Permit Renewals**: 3932 slots available
- **Motor Vehicles & Other Services**: 10917 slots available

## Next Steps

For HIGH DEMAND services:
1. Run discovery scans every 2-4 hours for 1 week
2. Track how often new appointments appear (churn rate)
3. If appointments appear regularly, enable queue/booking system
4. If appointments rarely appear, service may not be viable
