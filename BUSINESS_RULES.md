# BrickPro — Business Rules

Single source of truth for system behaviour. Code in later phases must follow this file.

Legend: **[Decided]** = confirmed by the owner. **[Proposed]** = suggested default, not yet confirmed. Edit this file if a proposal is wrong, before the related phase is coded.

---

## 1. Labour

| Field | Rule |
|---|---|
| Labour ID | **[Proposed]** Auto-generated `L-001`, `L-002`, ... Unique, never reused |
| Name | **[Proposed]** Required |
| Mobile | **[Decided]** Required. **[Proposed]** 10-digit Indian number, unique per labour |
| Address | **[Decided]** Only the village name (`village`, text) |
| Photo | **[Decided]** Optional |
| Joining date | **[Proposed]** Required. Attendance cannot be marked before it |
| Daily rate | **[Decided]** Required. Differs from labour to labour |
| Status | **[Decided]** `ACTIVE` / `INACTIVE`. Labour can leave and return |

**Leave and return — [Decided]:** labour is never deleted. Leaving sets `INACTIVE`; returning re-activates the same record, and all old attendance, payments and balance stay intact.

**Rate change rules**
- **[Decided]** The rate does not change once set.
- **[Proposed]** If a correction is ever unavoidable, only the Owner can do it. It creates a `LabourRateHistory` entry (old rate, new rate, effective date, reason, changed by). Old attendance keeps the rate it was earned at; the new rate applies from the effective date only.

## 2. Attendance

```text
PRESENT   = 1 day
HALF_DAY  = 0.5 day
ABSENT    = 0 days
```

| Question | Rule |
|---|---|
| Day values | **[Proposed]** As above. `earned = days × dailyRate` |
| One record per labour per date | **[Proposed]** Yes (unique on `labour + date`) |
| Can previous attendance be edited? | **[Decided]** Yes. Every edit is written to the audit log (old → new, who, when) |
| Can processed attendance be changed? | **[Proposed]** "Processed" means falling inside a settled salary period (see section 4). After settlement it is locked; only the Owner can unlock it, with a mandatory reason, and it is audit logged. Before settlement, no lock |
| Who can edit attendance? | **[Proposed]** Owner and Manager: any date. Staff: mark and edit today's attendance only |
| Future dates | **[Proposed]** Not allowed |
| No entry for a day | **[Proposed]** Counts as 0 days |
| Inactive labour | **[Proposed]** Cannot be marked for dates after they became inactive |

## 3. Payments

```text
BOOKING_ADVANCE   Money given so the labour does not leave for work elsewhere
SALARY_PAYMENT    Any payment against earned salary (mid-week withdrawals, final payout)
OTHER             Anything else (note mandatory)
```

| Question | Rule |
|---|---|
| Counts toward total received? | **[Decided]** Yes, all types count |
| Payment method | **[Decided]** Mostly cash. **[Proposed]** `CASH` (default), `UPI`, `BANK` |
| Multiple advances? | **[Proposed]** Yes. Any number of `BOOKING_ADVANCE` entries per labour |
| Can payments be corrected? | **[Decided]** Yes. **[Proposed]** Edit amount, date, type or note; each edit audit logged |
| Can financial records be deleted? | **[Decided]** Yes, wrong entries are deleted. **[Proposed]** Implemented as a soft delete (`isDeleted`, `deletedBy`, `deletedAt`, reason). Balances recalculate as if it never existed, but the trace stays in the audit log |
| Who can correct or delete? | **[Proposed]** Owner and Manager. Staff cannot touch payments |
| Is a note/reason required? | **[Proposed]** Optional for normal payments. **Required** for `OTHER`, for any correction, and for any deletion |
| Amount | **[Proposed]** Must be greater than 0. Date cannot be in the future |

## 4. Salary

**[Decided]** There is no fixed salary week. Labourers withdraw money only when they need it (mostly about every 7 days, for groceries), and at season (year) end they take the total pending salary.

| Question | Rule |
|---|---|
| Week start / end | **[Decided]** Not fixed. Weekly views are only date filters (this week, last 7 days, custom range) |
| Salary payment day | **[Decided]** No fixed day. Paid on demand |
| Sunday handling | **[Proposed]** Sunday is a normal day: paid only if marked PRESENT or HALF_DAY. No special rule or auto-pay. Same for any holiday (**[Decided]** holidays are not fixed) |
| Calculation | **[Decided]** Automatic |
| Half-day calculation | **[Proposed]** `0.5 × dailyRate` |
| Advance deduction | **[Decided]** Advances count as received. **[Proposed]** No manual deduction step: the balance is always `totalEarned − totalReceived` |
| Manual adjustment | **[Decided]** Allowed. **[Proposed]** Stored as separate entries (signed amount, mandatory reason, who, when), never by overwriting totals |
| Unpaid balance | **[Proposed]** Carries forward automatically in the running balance. It is never reset by a week ending |
| Overpaid labour | **[Decided]** Balance shown negative and highlighted in **red** everywhere (lists, profile, reports) |

**Formulas**

```text
totalEarned   = Σ (attendanceDays × dailyRate)
totalReceived = Σ non-deleted payments (all types)
balance       = totalEarned − totalReceived + Σ manualAdjustments
```

**Season / `SalaryPeriod` — [Proposed]:** a salary period is a season (`startDate`, `endDate`, `status: OPEN | SETTLED`). At season end the Owner runs a Season Settlement: remaining balances are paid out, attendance in that period is locked, and any negative balance is either carried into the next period or written off (Owner chooses per labour).

## 5. Trucks

```text
WORKING
STOPPED
MAINTENANCE
```

| Question | Rule |
|---|---|
| Truck number | **[Proposed]** Required, unique |
| Driver | **[Decided]** Needed, chosen from existing labour. **[Proposed]** One driver per truck at a time; driver changes are recorded in history |
| Model / type | **[Proposed]** Optional free text. Optional `capacity` |
| Reason for stopping | **[Decided]** `BREAKDOWN`, `TYRE_PUNCTURE`, `DRIVER_ABSENT`. **[Proposed]** plus `OTHER` with a note |
| Maintenance information | **[Decided]** Required history. **[Proposed]** Each entry: date, description, cost (optional), status (open/completed) |
| Status history | **[Decided]** Required. **[Proposed]** Every status change stores truck, from, to, reason, note, changedBy, timestamp. Returning to `WORKING` closes the open stop |
| Who can change status | **[Proposed]** Owner, Manager and Staff |

## 6. Roles — [Proposed]

| Role | Access |
|---|---|
| OWNER | Everything: users, backups, audit logs, rate changes, season settlement, unlock locked attendance |
| MANAGER | Labour, attendance (any date), payments, trucks, reports. No users, backups, rate edits or settlement |
| STAFF | Mark today's attendance, update truck status |

## 7. General

- Currency INR (₹), Indian digit grouping (`₹1,23,456`).
- Dates stored in UTC, displayed in IST (`DD MMM YYYY`).
- Nothing important is hard-deleted: soft delete plus audit log for labour, attendance, payments and trucks.
- Audit log records user, action, entity, entity id, before/after values, timestamp.

## 8. Open Questions

1. Confirm the **[Proposed]** required labour fields (section 1).
2. Confirm who can edit attendance and payments (sections 2, 3, 6).
3. Season end: carry forward or write off a negative balance? (section 4)
4. Any extra truck details needed (RC number, insurance expiry)? (section 5)