# BrickPro — Business Rules

Single source of truth for how the system behaves. Code in later phases must follow this file.

Legend: **[Decided]** = confirmed by the owner. **[Proposed]** = my suggested default, not yet confirmed — change it here if wrong, before Phase 1 coding.

---

## 1. Labour

| Rule | Decision |
|---|---|
| Required fields | **[Proposed]** `name`, `mobile`, `village`, `dailyRate`, `joiningDate` |
| Mobile number | **[Decided]** Mandatory (10-digit Indian number, unique per labour) |
| Address | **[Decided]** Only `village` name (text) |
| Photo | **[Decided]** Optional |
| Leave and return | **[Decided]** Allowed. Labour is never deleted; status toggles `active` / `inactive`. On return, the same record is re-activated and history is kept |
| Labour ID | **[Proposed]** Auto-generated `L-001`, `L-002`, ... |
| Daily rate | **[Decided]** Rate differs from labour to labour, set once at creation, and does not change |
| Rate change handling | **[Proposed]** Normal users cannot edit the rate. If it ever must change, only an Owner/Admin can do it, a `rateHistory` entry (old rate, new rate, effective date, changed by) is stored, and the new rate applies only from the effective date forward. Past attendance keeps the rate it was earned at |

## 2. Attendance

| Rule | Decision |
|---|---|
| Present | **[Proposed]** = 1 day |
| Half Day | **[Proposed]** = 0.5 day |
| Absent | **[Proposed]** = 0 days |
| One record per labour per date | **[Proposed]** Yes (unique on `labour + date`) |
| Editing | **[Decided]** Allowed. Every edit is written to the audit log (old value → new value, who, when) |
| Working week | **[Decided]** Not fixed. The system does not depend on a week start day |
| Holidays | **[Decided]** Not fixed. No holiday calendar. A day with no attendance entry counts as 0 days; owner can bulk-mark a day as "No work" if needed |
| Future dates | **[Proposed]** Attendance cannot be marked for future dates |
| Earnings | **[Proposed]** `earned = days × dailyRate` for each attendance record |

## 3. Payments and Advances

| Rule | Decision |
|---|---|
| Booking advance | **[Decided]** Advance money given to a labour so that they do not leave for work elsewhere |
| Advance vs total received | **[Decided]** Advances **count toward** total received |
| Payment types | **[Decided]** Mostly cash. **[Proposed]** Types: `booking_advance`, `advance`, `salary_payment`; Methods: `cash` (default), `upi`, `bank` |
| Correction | **[Decided]** Payments can be corrected (edit amount / date / note) |
| Wrong payment entry | **[Decided]** Delete it. **[Proposed]** Implemented as a soft delete (`isDeleted = true`) plus an audit log entry, so the balance recalculates but there is still a trace of who deleted what |
| Required fields | **[Proposed]** `labour`, `amount` (> 0), `date`, `type`, `method`, optional `note` |

## 4. Salary

| Rule | Decision |
|---|---|
| Salary period | **[Decided]** No fixed week. Labourers usually withdraw money only when needed for groceries (mostly after ~7 days). At season (year) end they take the total pending salary |
| Model | **[Proposed]** Running balance per labour for the active season, not week-bound |
| Calculation | **[Decided]** Automatic |
| Formula | **[Proposed]** `totalEarned = Σ(days × rate)` over the season<br>`totalReceived = Σ(all non-deleted payments and advances)`<br>`balance = totalEarned − totalReceived + manualAdjustments` |
| Manual adjustment | **[Decided]** Allowed. **[Proposed]** Stored as separate `adjustment` entries (positive or negative amount + mandatory reason + who), never by overwriting totals |
| Overpaid labour | **[Decided]** Balance shows **negative** and is highlighted in **red** everywhere (list, detail, reports) |
| Season | **[Proposed]** A `season` has a `startDate` and `endDate`. At season end, an owner does "Season Settlement": remaining balance is paid out, and any negative balance is either carried forward or written off (owner chooses) |
| Weekly views | **[Proposed]** Reports can still show any chosen date range ("this week", "last 7 days"), but the range is just a filter, not a salary cycle |

## 5. Trucks

| Rule | Decision |
|---|---|
| Required information | **[Proposed]** `truckNumber` (unique), `name/model` (optional), `capacity` (optional), `status` |
| Status | **[Decided]** `working`, `stopped`, `maintenance` |
| Driver | **[Decided]** Needed. The driver is selected from the existing labour list (`driver → Labour`). **[Proposed]** One driver per truck at a time; driver change is recorded in history |
| Stop reasons | **[Decided]** `breakdown`, `tyre_puncture`, `driver_absent`. **[Proposed]** plus `other` with a free-text note |
| Stop history | **[Proposed]** Each stop stores `truck`, `reason`, `startedAt`, `endedAt`, `note`. Setting status back to `working` closes the open stop |
| Maintenance history | **[Decided]** Required. **[Proposed]** Each entry stores `truck`, `date`, `description`, `cost` (optional), `status` (open/completed) |
| Dashboard "Working Trucks" | `count(working) / count(all trucks)` |

## 6. Roles (proposed)

| Role | Access |
|---|---|
| Owner | Everything, including users, backups, audit logs, rate changes, season settlement |
| Manager | Labour, attendance, payments, trucks, reports. No user management, backup, or rate edits |
| Staff | Mark attendance and update truck status only |

## 7. General

- Currency: INR (₹), formatted with Indian digit grouping (`₹1,23,456`).
- Dates: stored in UTC, displayed in IST (`DD MMM YYYY`).
- Nothing important is hard-deleted. Soft delete plus audit log for labour, attendance, payments, and trucks.
- Audit log captures: user, action, entity, entity id, before/after, timestamp.

## 8. Open Questions

1. Confirm the **[Proposed]** required labour fields (section 1).
2. Confirm roles and who can edit past attendance (section 6).
3. Season-end: carry forward or write off a negative balance? (section 4)
4. Is anything else needed per truck (RC number, insurance expiry)? (section 5)
