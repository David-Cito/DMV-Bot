# DMV Locations and Services Spec

This spec documents all DMV locations and their available services with the exact selectors and IDs needed for bot automation.

## Location Selection

**Container:** `#location`

**Selector:** `.location.button-look.next[data-loc-val="${CODE}"]`

**Verification:** `data-loc-nam-val` attribute contains location name

---

## Locations Reference

### Driver License Locations (Green)

| Code | Name | ID |
|------|------|-----|
| CCDL | Commercial Drivers License (CDL) | location_0 |
| KAPA | Kapālama Driver License, State ID | location_1 |
| KAPO | Kapolei Driver License, State ID | location_2 |
| KOOL | Koolau Driver License, State ID | location_3 |
| WADL | Wahiawa Driver License, State ID | location_4 |
| WAIA | Waianae Driver License, State ID | location_5 |

### Satellite City Halls - DL Renewals (Blue)

| Code | Name | ID |
|------|------|-----|
| FSCH | Downtown Satellite City Hall | location_6 |
| HKAI | Hawaii Kai Satellite City Hall | location_7 |
| PEAR | Pearlridge Satellite City Hall | location_8 |
| WIND | Windward City Satellite City Hall | location_9 |

### Satellite City Halls - Other Services (Dark Blue)

| Code | Name | ID |
|------|------|-----|
| ALAM | Ala Moana Satellite City Hall | location_10 |
| KSCH | Kapālama Satellite City Hall | location_11 |
| KAPS | Kapolei Satellite City Hall | location_12 |
| WAHI | Wahiawa Satellite City Hall | location_13 |
| WAIS | Waianae Satellite City Hall | location_14 |

---

## Service/Transaction Selection

**Container:** `#transaction`

**Selector:** `.transaction.button-look[data-trans-val="${VAL}"]`

**Verification:** `data-trans-name` attribute contains service name

**Disabled Check:** Element has `btn-disabled` class

---

## Services by Location

### CCDL - Commercial Drivers License (CDL)

| Val | Service | Type | Status |
|-----|---------|------|--------|
| 232 | Commercial Driver License Services | - | Available |
| 237 | CDL Only | - | Disabled |
| 266 | Written Test | - | Disabled |

### KAPA - Kapālama Driver License, State ID

| Val | Service | Type | Status |
|-----|---------|------|--------|
| 236 | Hawaii License Duplicate | DL | Available |
| 186 | Hawaii License Renewal | DL | Available |
| 187 | Hawaii Provisional to a Full License (Not a Road Test Appointment) | DL | Available |
| 288 | Instruction Permit (Online Test Follow-up) | DL | Available |
| 188 | Instruction Permit Duplicate | DL | Available |
| 279 | Instruction Permit Initial (In-person Written Test) | IPT | Available |
| 190 | Instruction Permit Renewal | DL | Available |
| 191 | Out Of State Transfer | DL | Available |
| 192 | State ID Duplicate | DL | Available |
| 193 | State ID Initial | DL | Available |
| 194 | State ID Renewal | DL | Available |
| 51 | Financial Responsibility Section Services (FRS) | - | Disabled |
| 289 | Instruction Permit Online | IPT | Disabled |
| 123 | Road Test Appointments | RT | Disabled |

### KAPO - Kapolei Driver License, State ID

| Val | Service | Type | Status |
|-----|---------|------|--------|
| 105 | Hawaii License Duplicate | DL | Available |
| 195 | Hawaii License Renewal | DL | Available |
| 196 | Hawaii Provisional to a Full License (Not a Road Test Appointment) | DL | Available |
| 287 | Instruction Permit (Online Test Follow-up) | DL | Available |
| 197 | Instruction Permit Duplicate | DL | Available |
| 280 | Instruction Permit Initial (In-person Written Test) | IPT | Available |
| 199 | Instruction Permit Renewal | DL | Available |
| 200 | Out Of State Transfer | DL | Available |
| 201 | State ID Duplicate | DL | Available |
| 202 | State ID Initial | DL | Available |
| 203 | State ID Renewal | DL | Available |
| 290 | Instruction Permit Online | IPT | Disabled |
| 126 | Road Test Appointments | RT | Disabled |
| 139 | CASHIER | CASHIER | Disabled |

### KOOL - Koolau Driver License, State ID

| Val | Service | Type | Status |
|-----|---------|------|--------|
| 2 | Hawaii License Duplicate | DL | Available |
| 204 | Hawaii License Renewal | DL | Available |
| 205 | Hawaii Provisional to a Full License (Not a Road Test Appointment) | DL | Available |
| 286 | Instruction Permit (Online Test Follow-up) | DL | Available |
| 206 | Instruction Permit Duplicate | DL | Available |
| 281 | Instruction Permit Initial (In-person Written Test) | IPT | Available |
| 208 | Instruction Permit Renewal | DL | Available |
| 209 | Out Of State Transfer | DL | Available |
| 210 | State ID Duplicate | DL | Available |
| 211 | State ID Initial | DL | Available |
| 212 | State ID Renewal | DL | Available |
| 291 | Instruction Permit Online | IPT | Disabled |
| 8 | Road Test Appointments | RT | Disabled |

### WADL - Wahiawa Driver License, State ID

| Val | Service | Type | Status |
|-----|---------|------|--------|
| 106 | Hawaii License Duplicate | DL | Available |
| 214 | Hawaii License Renewal | DL | Available |
| 215 | Hawaii Provisional to a Full License (Not a Road Test Appointment) | DL | Available |
| 285 | Instruction Permit (Online Test Follow-up) | DL | Available |
| 216 | Instruction Permit Duplicate | DL | Available |
| 282 | Instruction Permit Initial (In-person Written Test) | IPT | Available |
| 218 | Instruction Permit Renewal | DL | Available |
| 219 | Out Of State Transfer | DL | Available |
| 220 | State ID Duplicate | DL | Available |
| 221 | State ID Initial | DL | Available |
| 222 | State ID Renewal | DL | Available |
| 292 | Instruction Permit Online | IPT | Disabled |
| 128 | Road Test Appointments | RT | Disabled |

### WAIA - Waianae Driver License, State ID

| Val | Service | Type | Status |
|-----|---------|------|--------|
| 107 | Hawaii License Duplicate | DL | Available |
| 223 | Hawaii License Renewal | DL | Available |
| 224 | Hawaii Provisional to a Full License (Not a Road Test Appointment) | DL | Available |
| 284 | Instruction Permit (Online Test Follow-up) | DL | Available |
| 225 | Instruction Permit Duplicate | DL | Available |
| 283 | Instruction Permit Initial (In-person Written Test) | IPT | Available |
| 227 | Instruction Permit Renewal | DL | Available |
| 228 | Out Of State Transfer | DL | Available |
| 229 | State ID Duplicate | DL | Available |
| 230 | State ID Initial | DL | Available |
| 231 | State ID Renewal | DL | Available |
| 293 | Instruction Permit Online | IPT | Disabled |
| 130 | Road Test Appointments | RT | Disabled |
| 278 | Cashier | CASHIER | Disabled |

### FSCH - Downtown Satellite City Hall

| Val | Service | Type | Status |
|-----|---------|------|--------|
| 157 | Motor Vehicles & Other Services / Holo Card & Disability Parking Permits | - | Available |
| 256 | DRIVER LICENSE & STATE ID Renewals | - | Available |
| 96 | Driver License or State ID Duplicates & Instruction Permit Renewals | - | Available |
| 156 | Express Line Services | - | Disabled |
| 110 | Limited DL & State ID Services | - | Disabled |
| 158 | Dealer Service Not Offered | - | Disabled |

### HKAI - Hawaii Kai Satellite City Hall

| Val | Service | Type | Status |
|-----|---------|------|--------|
| 155 | Motor Vehicles & Other Services / Holo Card & Disability Parking Permits | - | Available |
| 99 | DRIVER LICENSE & STATE ID Renewals | - | Available |
| 255 | Driver License or State ID Duplicates & Instruction Permit Renewals | - | Available |
| 115 | Express Line Services | - | Disabled |
| 109 | Limited DL & State ID Services | - | Disabled |
| 274 | Dealer Service Not Offered | - | Disabled |

### PEAR - Pearlridge Satellite City Hall

| Val | Service | Type | Status |
|-----|---------|------|--------|
| 84 | Motor Vehicles & Other Services / Holo Card & Disability Parking Permits | - | Available |
| 257 | DRIVER LICENSE & STATE ID Renewals | - | Available |
| 252 | Driver License or State ID Duplicates & Instruction Permit Renewals | - | Available |
| 116 | Express Line Services | - | Disabled |
| 178 | Limited DL & State ID Services | - | Disabled |
| 82 | Rooftop Entrance Notice | - | Disabled |

### WIND - Windward City Satellite City Hall

| Val | Service | Type | Status |
|-----|---------|------|--------|
| 113 | Motor Vehicles & Other Services / Holo Card & Disability Parking Permits | - | Available |
| 98 | DRIVER LICENSE & STATE ID Renewals | - | Available |
| 101 | Driver License or State ID Duplicates & Instruction Permit Renewals | - | Available |
| 153 | Express Line Services | - | Disabled |
| 108 | Limited DL & State ID Services | - | Disabled |
| 142 | Dealer Service Not Offered | - | Disabled |

### ALAM - Ala Moana Satellite City Hall

| Val | Service | Type | Status |
|-----|---------|------|--------|
| 235 | Disability Parking Permits | - | Available |
| 146 | Motor Vehicles & Other Services | - | Available |
| 265 | U.S. Passport | - | Available |
| 165 | Express Line Services | - | Disabled |
| 164 | Dealer Service Not Offered | - | Disabled |
| 166 | DL & State ID Not Available | - | Disabled |

### KSCH - Kapālama Satellite City Hall

| Val | Service | Type | Status |
|-----|---------|------|--------|
| 66 | Motor Vehicles & Other Services / Holo Card & Disability Parking Permits | - | Available |
| 174 | Express Line Services | - | Disabled |
| 175 | Dealer Service Not Offered | - | Disabled |
| 111 | DL & State ID Not Available | - | Disabled |

### KAPS - Kapolei Satellite City Hall

| Val | Service | Type | Status |
|-----|---------|------|--------|
| 294 | Disability Parking Permit / Holo Card | - | Available |
| 176 | Motor Vehicles & Other Services | - | Available |
| 267 | U.S. Passport | - | Available |
| 258 | Express Line Services | - | Disabled |
| 152 | Dealer Service Not Offered | - | Disabled |
| 168 | DL & State ID Not Available | - | Disabled |

### WAHI - Wahiawa Satellite City Hall

| Val | Service | Type | Status |
|-----|---------|------|--------|
| 95 | Motor Vehicles & Other Services / Holo Card & Disability Parking Permits | - | Available |
| 268 | U.S. Passport | - | Available |
| 161 | Express Line Services | - | Disabled |
| 162 | Dealer Service Not Offered | - | Disabled |
| 94 | DL & State ID Not Available | - | Disabled |

### WAIS - Waianae Satellite City Hall

| Val | Service | Type | Status |
|-----|---------|------|--------|
| 275 | Motor Vehicles & Other Services / Holo Card & Disability Parking Permits | - | Available |
| 170 | Express Line Services | - | Disabled |
| 172 | Dealer Service Not Offered | - | Disabled |
| 177 | DL & State ID Not Available | - | Disabled |

---

## Currently Tracked by Monitoring Bots

| Location | Code | Service | Val |
|----------|------|---------|-----|
| Downtown Satellite City Hall | FSCH | DRIVER LICENSE & STATE ID Renewals | 256 |
| Hawaii Kai Satellite City Hall | HKAI | DRIVER LICENSE & STATE ID Renewals | 99 |
| Pearlridge Satellite City Hall | PEAR | DRIVER LICENSE & STATE ID Renewals | 257 |
| Windward City Satellite City Hall | WIND | DRIVER LICENSE & STATE ID Renewals | 98 |

---

## Usage Example

```typescript
// Select location
const locationTile = page.locator(`.location.button-look.next[data-loc-val="KAPA"]`);
await locationTile.click();

// Select service
const serviceTile = page.locator(`.transaction.button-look[data-trans-val="186"]`);
// Verify not disabled
const isDisabled = await serviceTile.evaluate(el => el.classList.contains('btn-disabled'));
if (!isDisabled) {
  await serviceTile.click();
}
```
