# BrickPro — Business Rules

Single source of truth for system behaviour. Code in later phases must follow this file.

Legend: **[Decided]** = confirmed by the client. **[Proposed]** = suggested default, not yet confirmed. **[Open]** = must be confirmed with the client before the financial calculation is frozen — do not guess.

---

## 1. Worker types

Every labour record has a `labourType`. It decides how work is recorded and how earnings are calculated.

| | **Bigari** | **Maapvali** | **Patlavale** |
|---|---|---|---|
| Who | One individual worker | One individual worker, commonly transporting bricks | A **family / team** that produces raw bricks |
| Work is recorded by | Attendance: Present / Half Day / Absent | Daily maap work entries | Production ledger (physical bricks per entry) |
| Rate field | `dailyRate` | `ratePerMaap` | `ratePer1000PayableBricks` |
| Rate belongs to | That worker | That worker (rates differ per worker) | That team |
| Earnings | Working units x daily rate | `numberOfMaaps x ratePerMaap` | `(payable bricks / 1000) x ratePer1000PayableBricks` |
| Paid to | The worker | The worker | **The team** (family shares it themselves) |
| Supports Bayana, advances, payments, balance | Yes | Yes | Yes |

**[Decided]**
- Attendance is **not** the earnings basis for Maapvali or Patlavale.
- A record may carry only the rate field of its own type.
- Salary for a Patlavale team is never calculated or split per family member. Members are optional reference details.
- Mobile number is mandatory and unique. Village is required (no full address). Photo is optional.
- A worker or team can leave and return: never deleted, status toggles `ACTIVE` / `INACTIVE`, history is kept.
- Record IDs share one sequence (`L-001`, `L-002`, ...), are generated automatically, and are never reused.

## 2. Bigari

- **[Decided]** Work is recorded by attendance: `PRESENT`, `HALF_DAY`, `ABSENT`. One record per labour per date; attendance can be edited; no future dates.
- **[Decided]** Earnings use that worker's agreed daily rate.
- **[Decided]** The daily rate differs per worker and **can change**; every change is kept in rate history. Past attendance keeps the rate it was earned at; a new rate applies from its effective date. Each change stores old rate, new rate, effective date, reason, who and when.
- **[Proposed]** Only the Owner can change a rate. The effective date must be after the previous change; a future date shows as "Scheduled".
- **[Proposed]** `PRESENT` = 1 day, `HALF_DAY` = 0.5 day, `ABSENT` = 0. Working units = present days + half days x 0.5; earned = sum of (units x the rate in force that day).
- **[Open]** The exact Bigari half-day rule and rate basis.
- **[Proposed]** A day with no record counts as 0 days. There is no fixed salary week and no fixed holidays: weekly views are date filters.

## 3. Maapvali

- **[Decided]** One maap is approximately **275 bricks** transported. Four maaps = 1,100 physical bricks.
- **[Decided]** Earnings = `numberOfMaaps x that worker's ratePerMaap`.
- **[Decided]** Different Maapvali workers can have different rates per maap.
- **[Decided]** Do **not** use the Patlavale 1,100-to-1,000 payable conversion for Maapvali.
- **[Proposed]** Work is recorded as daily maap entries (see data shapes). Each entry stores a snapshot of the rate used, so a later rate change never rewrites old earnings.
- **[Proposed]** Entries can be corrected; every correction is audit logged with a reason.

## 4. Patlavale (family / team)

- **[Decided]** One record per family / team. Its `name` is the team name.
- **[Decided]** Four maaps represent 1,100 **physical** bricks, but the team is paid for only 1,000 **payable** bricks. The extra 100 physical bricks are not paid separately.
- **[Decided]** Every completed group of **1,100 physical bricks** generates **1,000 payable bricks**.
- **[Decided]** Leftover physical bricks carry forward into later entries until another full group of 1,100 is completed.
- **[Decided]** Each team has its own agreed rate per 1,000 payable bricks.
- **[Decided]** Production accumulates through the season. A payment **never** resets production totals, payable units or carried-forward bricks.
- **[Decided]** Keep **physical bricks**, **payable bricks** and **carry-forward physical bricks** as separate values.
- **[Open]** How to settle an incomplete final group at season end, if at all.

Integer arithmetic for every production entry:

```text
physicalAvailable  = newPhysicalBricks + previousCarryBricks
completedGroups    = floor(physicalAvailable / 1100)
newPayableBricks   = completedGroups x 1000
carryForwardBricks = physicalAvailable - completedGroups x 1100
newEarnings        = (newPayableBricks / 1000) x ratePer1000PayableBricks
```

Worked example (illustrative values, rate 250 per 1,000 payable bricks):

| Entry | New physical | Previous carry | Physical available | New payable | Carry after |
|---|---:|---:|---:|---:|---:|
| Day 1 | 1,500 | 0 | 1,500 | 1,000 | 400 |
| Day 2 | 800 | 400 | 1,200 | 1,000 | 100 |
| Day 3 | 1,000 | 100 | 1,100 | 1,000 | 0 |

## 5. Payments and Bayana

- **[Decided]** A payment is a **financial transaction, not a work record**. It records: transaction date, amount, recipient, transaction type, and an optional note / reference.
- **[Decided]** The recipient is a worker (Bigari or Maapvali) **or** a Patlavale team. All three types support Bayana.
- **[Decided]** Types: `BOOKING_ADVANCE` (shown in the interface as **Bayana (Booking Advance)**), `SALARY_PAYMENT`, `OTHER`. The stored value stays `BOOKING_ADVANCE`.
- **[Decided]** Payments change financial balances only. They never delete or reset attendance, maap entries, production or carry-forward values.
- **[Decided]** Transaction history stays traceable: no silent overwrite or removal. A payment can be corrected, and a wrong one is deleted as a soft delete, always with a reason, and recorded in the audit log.
- **[Proposed]** Amount > 0; date not in the future (a Bayana may be dated before the joining date). A note is required for `OTHER`. Payments are mostly cash (`CASH` default, `UPI`, `BANK`).
- **[Open]** Is Bayana always money received / advance against earnings, or is any part treated differently?
- **[Open]** Should `OTHER` payments reduce earned salary, or be shown separately?
- **[Open]** Until the two answers above are confirmed, the prototype counts every payment type as received. Avoid subtracting an advance twice.

## 6. Balance

```text
balance = earned - total received
```

- Earned: Bigari = sum of (units x rate that day); Maapvali = sum of maap entry earnings; Patlavale = sum of production entry `newEarnings`.
- **[Decided]** A negative balance (overpaid) is shown in red.
- **[Proposed]** Totals are calculated from records, never stored. Prototype calculations in the app are for building the screens; **final financial calculations belong to the backend.**
- **[Open]** Season start / end dates and the season closing procedure. Production and maap entries only reference a `seasonId` until then.

## 7. Trucks

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

## 8. Roles — [Proposed]

| Role | Access |
|---|---|
| OWNER | Everything: users, backups, audit logs, rate changes, season settlement, unlock locked records |
| MANAGER | Labour, attendance (any date), maap and production entries, payments, trucks, reports. No users, backups, rate edits or settlement |
| STAFF | Mark today's attendance, update truck status |

## 9. General

- Currency INR (₹), Indian digit grouping (`₹1,23,456`).
- Dates stored in UTC, displayed in IST (`DD MMM YYYY`).
- Nothing important is hard-deleted: soft delete plus audit log for labour, attendance, maap entries, production entries, payments and trucks.
- Audit log records user, action, entity, entity id, before/after values, timestamp.

---

## 10. Data shapes

These are the shapes used by the mock data and validated with Zod (`client/src/validators/labourRecordValidator.js`). The same shapes are intended for the backend models. No field is `undefined`: a record simply omits the fields of other types.

### Labour record (all types)

```js
{
  id: "L-001",
  labourType: "BIGARI",            // BIGARI | MAAPVALI | PATLAVALE
  name: "Ramesh Kumar",            // Patlavale: the team name
  mobile: "9876543210",
  village: "Sinnar",
  status: "ACTIVE",                // ACTIVE | INACTIVE
  joiningDate: "2026-05-01",
  photo: null,                     // optional

  // exactly ONE of these, matching labourType:
  dailyRate: 650,                  // BIGARI
  ratePerMaap: 22,                 // MAAPVALI
  ratePer1000PayableBricks: 650,   // PATLAVALE

  // PATLAVALE only, optional, reference details only (never salary recipients):
  members: [{ name: "Ganpat Jadhav", relation: "Head" }]
}
```

### Attendance record (Bigari only)

```js
{ id: "att-L-001-0", labourId: "L-001", date: "2026-10-08", status: "PRESENT" } // PRESENT | HALF_DAY | ABSENT
```

### Rate history entry (all types)

```js
{
  id: "rate-L-001-0", labourId: "L-001",
  rateType: "DAILY_RATE",          // DAILY_RATE | RATE_PER_MAAP | RATE_PER_1000_PAYABLE_BRICKS
  rate: 600, effectiveFrom: "2026-05-01",
  reason: "Initial rate", changedBy: "Ramesh Patel", createdAt: "2026-05-01"
}
```

### Maapvali daily maap entry

```js
{
  id: "maap-L-049-1", labourId: "L-049", seasonId: "season-2026", date: "2026-10-08",
  numberOfMaaps: 32,
  ratePerMaap: 22,                 // snapshot of the rate that day
  earnings: 704,                   // numberOfMaaps x ratePerMaap
  note: ""
}
```

### Patlavale production entry

```js
{
  id: "prod-L-055-1", teamId: "L-055", seasonId: "season-2026", date: "2026-10-08",
  newPhysicalBricks: 1500,
  previousCarryBricks: 0,
  physicalAvailable: 1500,
  completedGroups: 1,
  newPayableBricks: 1000,
  carryForwardBricks: 400,
  ratePer1000PayableBricks: 650,   // snapshot of the team's rate on that entry
  newEarnings: 650,
  note: ""
}
```

The ledger chains: each entry's `previousCarryBricks` equals the earlier entry's `carryForwardBricks`, and dates increase. The mock stores derived fields as a snapshot (like an audit ledger). **[Open for backend design]** whether the backend stores them or recalculates them from the raw entries. The UI can calculate previews now.

### Payment record

```js
{
  id: "pay-L-001-1",
  recipientType: "WORKER",         // WORKER (Bigari, Maapvali) | TEAM (Patlavale)
  recipientId: "L-001",
  labourId: "L-001",               // LEGACY alias of recipientId; existing screens still read it, removed in the Payments rework
  date: "2026-10-05",
  type: "SALARY_PAYMENT",          // BOOKING_ADVANCE (shown as Bayana) | SALARY_PAYMENT | OTHER
  amount: 3000,
  method: "CASH",                  // CASH | UPI | BANK
  note: "",
  reference: "",                   // optional
  isDeleted: false                 // soft delete; deletedReason / deletedAt added when deleted
}
```

### Season

```js
{ id: "season-2026", name: "Season 2026-27", startDate: null, endDate: null, status: "OPEN" } // dates still to be confirmed
```

---

## 11. Open questions for the client

1. Is Bayana always counted as money received / advance against earnings, or is any part treated differently?
2. Should `OTHER` payments reduce earned salary, or be displayed separately?
3. What is the exact Bigari half-day rule and rate basis?
4. How should an incomplete final Patlavale group be settled at season end, if at all?
5. What are the season start / end dates and the season closing procedure?
6. Can a Maapvali's `ratePerMaap` or a team's `ratePer1000PayableBricks` change during a season? (The data shape allows it through rate history.)
7. Who may correct or delete maap entries, production entries and payments?
