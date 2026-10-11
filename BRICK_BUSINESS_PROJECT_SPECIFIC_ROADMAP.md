# Brick Business Management — Project-Specific Development Roadmap

> **Purpose:** Continue the existing project in `Bricks Business Management/` one phase at a time. Finish and validate the frontend with mock data first, get the client's approval, and only then implement the backend and connect the API.
>
> **Important:** Do not delete the project or restart from scratch. This guide is based on the uploaded ZIP's actual file structure and the labour rules confirmed by the client.

---

## 1. Review of the current ZIP

### What is already built

The project uses React + Vite, React Router, Tailwind CSS, reusable UI components, React Hook Form, Zod validation, and a shared in-memory React context.

| Area | Current status from source review | Action |
|---|---|---|
| App shell, navigation, responsive layout | Present | Keep |
| Dashboard | Implemented with mock summaries and activity | Keep; update for the new labour types later |
| Labour Management | Implemented for individual workers with one daily rate | Extend for Bigari, Maapvali, and Patlavale teams |
| Labour Profile | Implemented with attendance, payment, and rate-history tabs | Extend to display the correct details for each labour type |
| Attendance | Implemented around individual daily attendance | Restrict to Bigari workers (unless the client confirms another attendance use) |
| Payments | Implemented with booking advance, salary payment, and other payment types | Extend recipient selection and account calculations for individual workers and Patlavale teams |
| Mock data and shared state | Present in `src/mock/` and `src/context/LabourContext.jsx` | Extend; do not replace unnecessarily |
| Salary, Trucks, Reports, Settings pages | Route placeholders or empty page files | Build in later frontend phases |
| Backend | `server/` contains scaffold files that are empty in the uploaded ZIP | Implement only after frontend approval |
| Business rules | `BUSINESS_RULES.md` exists, but it describes the older single-labour/daily-rate model | Update it with the confirmed three-type rules |

### Main gaps to fix

1. Labour records currently assume everyone is an individual with a `dailyRate`.
2. Maapvali need a per-person `ratePerMaap` and daily maap work entries.
3. Patlavale need a family/team record, a `ratePer1000PayableBricks`, and a season-long production ledger.
4. Attendance must not be the earnings calculation for Maapvali or Patlavale.
5. Payments currently point to a `labourId`; the design must also support payments to a Patlavale team.
6. The current payment type `BOOKING_ADVANCE` can represent Bayana, but the UI label should use the client's familiar term **Bayana (Booking Advance)**.
7. Existing mock totals and Dashboard cards are designed for the old attendance-based model; update their mock data when the new data model is ready.
8. `Salary.jsx`, `Trucks.jsx`, `Reports.jsx`, and `Settings.jsx` are not complete feature pages yet.
9. The backend folder is only a scaffold. Do not assume its current models/controllers/routes are implemented.

---

## 2. Confirmed business rules — use these as the source of truth

### Bigari
- Each Bigari is managed as an individual worker.
- Work is recorded by attendance: Present, Half-day, or Absent.
- Earnings use that worker's agreed daily rate and the client's attendance rules.
- Bigari supports Bayana, other advances, payments, and an account balance.

### Maapvali
- Each Maapvali is an individual worker, commonly transporting bricks.
- One maap = approximately 275 bricks transported.
- Four maaps = 1,100 physical bricks.
- Earnings = `numberOfMaaps × that worker's ratePerMaap`.
- Different Maapvali workers can have different per-maap rates.
- Do **not** use the Patlavale 1,100-to-1,000 payable conversion for Maapvali earnings.

### Patlavale
- Each Patlavale record represents a family/team that produces raw bricks.
- Salary is paid to the family/team; the family distributes the money internally. Do not calculate or split salary per family member.
- Four maaps represent 1,100 physical bricks, but the team is paid for only 1,000 payable bricks. The extra 100 physical bricks are not paid separately.
- Every completed group of 1,100 physical bricks generates 1,000 payable bricks.
- Physical leftovers carry forward into later production entries until another full group of 1,100 is completed.
- Each team has its own agreed rate per 1,000 payable bricks.
- Production accumulates through the season. A payment must **never** reset production totals, payable units, or carried-forward bricks.
- All three labour types support Bayana.

### Example of Patlavale carry-forward
Illustrative values; rates are not prescribed by this example.

| Entry | New physical bricks | Previous carry | Physical total available | New payable bricks | Carry after entry |
|---|---:|---:|---:|---:|---:|
| Day 1 | 1,500 | 0 | 1,500 | 1,000 | 400 |
| Day 2 | 800 | 400 | 1,200 | 1,000 | 100 |
| Day 3 | 1,000 | 100 | 1,100 | 1,000 | 0 |

Use integer arithmetic:
- `physicalAvailable = newPhysicalBricks + previousCarryBricks`
- `completedGroups = Math.floor(physicalAvailable / 1100)`
- `newPayableBricks = completedGroups * 1000`
- `carryForwardBricks = physicalAvailable - completedGroups * 1100`
- `newEarnings = (newPayableBricks / 1000) * ratePer1000PayableBricks`

The application must keep **physical bricks**, **payable bricks**, and **carry-forward physical bricks** as separate values.

### Payments and Bayana
- A payment is a financial transaction, not a work record.
- Record transaction date, amount, recipient, transaction type, and optional note/reference.
- Keep `BOOKING_ADVANCE` in the underlying data model if convenient, but label it `Bayana (Booking Advance)` in the interface.
- Existing business rules say all payment types count toward total received. Confirm the exact Bayana/advance treatment with the client before freezing the balance formula, and avoid subtracting an advance twice.
- Payments change financial balances only. They do not delete or reset attendance, maap entries, production, or carry-forward values.
- Keep transaction history traceable. Do not silently overwrite or remove records.

### Still confirm with the client before finalizing financial calculations
- Is Bayana always counted as money received/advance against earnings, or is any part treated differently?
- Should `OTHER` payments reduce earned salary, or be displayed separately?
- What is the exact Bigari half-day rule and rate basis?
- How should the client settle an incomplete final Patlavale group at season end, if at all?
- What season start/end dates and season closing procedure should be used?

Do not guess these unresolved accounting rules.

---

## 3. Work safely before changing code

### Phase 0 — Create a safe checkpoint

1. Open the existing project folder in VS Code.
2. Check `git status` and commit the current working version before edits.
3. Run the frontend and confirm the existing pages still work.
4. Use a separate branch for the new labour-type changes if you are using Git.

Commands from the project root:

```bash
git status
git add .
git commit -m "Checkpoint before labour type requirements update"
cd client
npm run dev
```

In another terminal, run a production build when ready:

```bash
npm run build
```

If there are existing uncommitted changes, review them before committing; do not blindly overwrite them.

---

# PART A — FRONTEND FIRST

## Phase 1 — Update the business rules and data shapes

**Goal:** agree on the shape of the mock data before changing forms and calculations.

### Files to review/update
- `BUSINESS_RULES.md`
- `client/src/mock/labours.js`
- `client/src/mock/attendance.js`
- `client/src/mock/payments.js`
- `client/src/mock/rateHistory.js`

### Proposed labour record shape

Keep a shared labour record structure where possible, and add a `labourType` field:

```js
{
  id: "L-001",
  labourType: "BIGARI", // BIGARI | MAAPVALI | PATLAVALE
  name: "Example name or family/team name",
  mobile: "",
  village: "",
  status: "ACTIVE",
  joiningDate: "YYYY-MM-DD",

  // Use the field relevant to labourType:
  dailyRate: 650,                    // BIGARI
  ratePerMaap: undefined,            // MAAPVALI
  ratePer1000PayableBricks: undefined // PATLAVALE
}
```

This is an example only. Make the TypeScript-free JavaScript object shape consistent and validate it with Zod. Do not keep treating `dailyRate` as the universal rate.

For Patlavale, use the team name as `name` or add a `teamName` field consistently. If family members are stored, they are optional reference details, not individual salary recipients.

### Proposed production entry shape

```js
{
  id: "prod-001",
  teamId: "L-050",
  seasonId: "season-2026",
  date: "YYYY-MM-DD",
  newPhysicalBricks: 1500,
  previousCarryBricks: 0,
  physicalAvailable: 1500,
  completedGroups: 1,
  newPayableBricks: 1000,
  carryForwardBricks: 400,
  ratePer1000PayableBricks: 250,
  newEarnings: 250,
  note: ""
}
```

Save a ledger entry for each production record. The example rate is illustrative. Decide whether derived fields are recalculated from entries or stored as a snapshot for audit purposes when designing the backend; the UI can display calculated previews now.

### Phase 1 done when
- `BUSINESS_RULES.md` reflects the three types and production rules.
- Each mock record has an unambiguous labour type.
- Mock IDs do not collide.
- No existing screen breaks just because a new field was added.

---

## Phase 2 — Update Labour Management

**Goal:** create and manage individuals and teams using the correct rate fields.

### Files to inspect/update
- `client/src/pages/LabourManagement.jsx`
- `client/src/features/labours/LabourForm.jsx`
- `client/src/features/labours/AddLabourModal.jsx`
- `client/src/features/labours/EditLabourModal.jsx`
- `client/src/features/labours/LabourTable.jsx`
- `client/src/features/labours/LabourCard.jsx`
- `client/src/features/labours/LabourFilters.jsx`
- `client/src/features/labours/labourSelectors.js`
- `client/src/features/labours/LabourSummaryCards.jsx`
- `client/src/validators/labourValidator.js`
- `client/src/context/LabourContext.jsx`
- `client/src/mock/labours.js`

### Build in this order
1. Add a Labour Type selector: Bigari, Maapvali, Patlavale.
2. Make the rate field conditional:
   - Bigari → Daily Rate (₹/day)
   - Maapvali → Rate per Maap (₹/maap)
   - Patlavale → Team Rate per 1,000 Payable Bricks (₹)
3. Make the labels clear that Patlavale is a family/team.
4. Update Zod validation so only the appropriate rate field is required for the selected type.
5. Update add/edit actions in `LabourContext.jsx` so the correct fields are retained.
6. Add type filters and show labour type and rate unit in tables/cards.
7. Keep the existing active/inactive behavior and do not delete history when deactivating a worker/team.
8. Update summary counts to show individual Bigari, individual Maapvali, and Patlavale teams distinctly.

### Phase 2 done when
- You can add, edit, search, and filter all three types with mock data.
- A Patlavale family is one salary account, not a collection of separately paid members.
- A rate for one labour type cannot accidentally be entered in another type's rate field.
- Existing labour profile links and mobile layout still work.

---

## Phase 3 — Keep Attendance Bigari-specific

**Goal:** avoid accidentally calculating Maapvali or Patlavale work as attendance salary.

### Files to inspect/update
- `client/src/pages/Attendance.jsx`
- `client/src/features/attendance/AttendanceList.jsx`
- `client/src/features/attendance/AttendanceRow.jsx`
- `client/src/features/attendance/attendanceSelectors.js`
- `client/src/context/LabourContext.jsx`
- `client/src/mock/attendance.js`

### Tasks
1. Filter the attendance roster to active Bigari workers only.
2. Show a helpful message if no Bigari workers are eligible for the selected date.
3. Keep the existing Present / Half-day / Absent controls and save/discard flow.
4. Ensure attendance earnings only contribute to Bigari earnings.
5. Do not create fake attendance for Maapvali maaps or Patlavale production.

### Phase 3 done when
- Attendance never includes a Patlavale family as a person.
- Attendance does not create earnings for Maapvali or Patlavale.
- Existing attendance editing works with mock data.

---

## Phase 4 — Build Maapvali Work Entry

**Goal:** record transported maaps and calculate each person's earnings.

### Suggested new files
- `client/src/pages/WorkEntries.jsx` or `client/src/pages/MaapvaliWork.jsx`
- `client/src/features/work/maapvali/`
- `client/src/mock/maapvaliWork.js`
- `client/src/utils/workCalculations.js`

Use the existing component patterns and naming conventions; do not create both page options.

### UI fields
- Date
- Maapvali worker
- Number of maaps transported
- Agreed rate per maap (auto-filled from worker profile, with any override requiring an explicit business decision)
- Earnings preview
- Optional note
- Save entry

Formula: `earnings = maaps × ratePerMaap`.

Display the approximate physical equivalent if helpful: `estimatedBricks = maaps × 275`. This is informational and must not alter salary calculation.

### Phase 4 done when
- Different workers can have different rates.
- A worker's work history shows date, maaps, rate, and earnings.
- Invalid negative/fractional maap values are handled according to the client's rules.
- Adding work does not alter the payment ledger.

---

## Phase 5 — Build Patlavale Production Ledger

**Goal:** record production, convert only completed 1,100-brick groups, and carry the remainder forward.

### Suggested new files
- `client/src/pages/PatlavaleProduction.jsx`
- `client/src/features/production/ProductionEntryForm.jsx`
- `client/src/features/production/ProductionLedger.jsx`
- `client/src/features/production/ProductionSummary.jsx`
- `client/src/mock/production.js`
- `client/src/utils/productionCalculations.js`

### UI fields
- Production date
- Patlavale family/team
- New physical bricks produced
- Previous carry-forward bricks (read-only)
- Total physical bricks available
- Completed groups of 1,100
- New payable bricks (1,000 per completed group)
- Remaining carry-forward bricks
- Team's rate per 1,000 payable bricks
- Earnings from this entry
- Season-to-date physical production, payable bricks, earnings, and carry-forward
- Optional note

### Required calculation behavior
Use one pure utility function for the calculation so it can be tested independently. Do not repeat slightly different formulas inside multiple React components.

Test:
- `1500 + 0 = 1500` → 1 completed group, 1,000 payable, 400 carry.
- `800 + 400 = 1200` → 1 completed group, 1,000 payable, 100 carry.
- `1000 + 100 = 1100` → 1 completed group, 1,000 payable, 0 carry.
- `900 + 100 = 1000` → 0 completed groups, 0 payable under the confirmed complete-group rule, 1,000 carry.
- A payment is recorded after work; production totals and carry stay unchanged.

### Important season rule
Production totals accumulate throughout the season. Payments can happen any time and must not reset the production ledger or carry-forward count.

### Phase 5 done when
- Each production entry is visible in the ledger.
- Carry-forward is correct across multiple days.
- Earnings use the team's rate.
- Team account balance can change after payment while production remains the same.

---

## Phase 6 — Update Payments and Bayana

**Goal:** reuse the existing Payments page and form while supporting both individuals and Patlavale teams.

### Files to inspect/update
- `client/src/pages/Payments.jsx`
- `client/src/features/payments/PaymentForm.jsx`
- `client/src/features/payments/LabourPicker.jsx`
- `client/src/features/payments/PaymentTypeSelect.jsx`
- `client/src/features/payments/PaymentHistory.jsx`
- `client/src/features/payments/PaymentSummaryTiles.jsx`
- `client/src/features/payments/paymentSelectors.js`
- `client/src/validators/paymentValidator.js`
- `client/src/utils/paymentTypes.js`
- `client/src/mock/payments.js`
- `client/src/context/LabourContext.jsx`

### Tasks
1. Let the recipient picker search individuals and Patlavale teams.
2. Show the labour type beside each recipient.
3. Label `BOOKING_ADVANCE` as **Bayana (Booking Advance)** in the UI.
4. Keep the current payment date, amount, note, edit/correction, and history patterns.
5. Ensure a payment to a Patlavale team is linked to the team ID.
6. Display the correct account balance for that recipient.
7. Keep payments separate from work/production records.
8. Update mock payment generation so mock totals remain internally consistent with the new labour types.
9. Keep transaction corrections traceable; do not silently erase records.

### Balance warning
The current implementation calculates earnings largely from attendance and subtracts all received payment types. Do not reuse that formula unchanged for all labour types. Create a clear account calculation layer that calculates:
- Bigari earnings from attendance and rate history.
- Maapvali earnings from maap work entries.
- Patlavale earnings from payable production units.
- Received transactions according to the accounting rule approved by the client.

### Phase 6 done when
- Bayana can be recorded for each labour type.
- A payment is linked to the correct individual or team.
- Payments do not change work counts or production carry.
- The UI clearly shows total earnings, total received, and balance with no double deduction.

---

## Phase 7 — Update Labour Profile / Account Statement

**Goal:** one place to see the complete history of an individual or team.

### Files
- `client/src/pages/LabourProfile.jsx`
- `client/src/features/labours/profile/ProfileHeader.jsx`
- `client/src/features/labours/profile/AttendanceTab.jsx`
- `client/src/features/labours/profile/PaymentsTab.jsx`
- `client/src/features/labours/profile/RateHistoryTab.jsx`
- `client/src/features/labours/labourStats.js`
- `client/src/context/LabourContext.jsx`

### Type-specific profile content
- **Bigari:** attendance history, daily rates, earned amount, Bayana/advances, payments, balance.
- **Maapvali:** maap entries, rate per maap, earned amount, Bayana/advances, payments, balance.
- **Patlavale:** family/team details, production ledger, physical production, payable production, carry-forward, team rate, season earnings, Bayana/advances, payments, balance.

Hide or rename tabs that do not apply to the selected type. A Patlavale family should not see an individual attendance tab as its earnings source.

### Phase 7 done when
- The profile matches the labour type.
- Work history and payments are shown separately.
- Seasonal production remains visible after payments.

---

## Phase 8 — Update Dashboard Mock Data

**Goal:** show useful totals across three different labour types.

### Files
- `client/src/pages/Dashboard.jsx`
- `client/src/features/dashboard/`
- `client/src/mock/dashboard.js`
- `client/src/features/dashboard/useDashboardData.js`

Possible cards:
- Bigari active / present today
- Active Maapvali count and maaps recorded today
- Active Patlavale teams and physical bricks produced this season
- Payable Patlavale bricks this season
- Total outstanding balance
- Recent payments

Use mock data consistently with the new records. Do not display misleading attendance counts that include Maapvali or Patlavale.

### Phase 8 done when
- Dashboard values match the underlying mock entries.
- Payments affect financial cards but never reset production totals.
- The UI clearly distinguishes physical bricks from payable bricks.

---

## Phase 9 — Complete remaining frontend pages

Do these only after Phases 1–8 are stable.

### Salary
Files: `client/src/pages/Salary.jsx`, `client/src/mock/salary.js`, and related features.
- No fixed salary week: allow date-range filters such as this week, last 7 days, and custom range.
- Show earned, received, and outstanding balances by labour type.
- Payments do not reset season-to-date totals.
- Confirm the season settlement process with the client before designing a final settlement action.

### Trucks
Files: `client/src/pages/Trucks.jsx`, `client/src/mock/trucks.js`, and route/navigation configuration.
- Working, stopped, and maintenance states.
- Stop reason and status history.
- Driver selection from eligible labour records only if the client still wants drivers linked to labour records.
- Keep this separate from labour earnings.

### Reports
Files: `client/src/pages/Reports.jsx` and relevant report components.
- Bigari attendance and earnings.
- Maapvali maaps and earnings.
- Patlavale season physical production, payable bricks, carry-forward, earnings, payments, and balance.
- Bayana and payment history.

### Settings
Files: `client/src/pages/Settings.jsx` and relevant components.
- Only include settings confirmed as necessary by the client.

### Phase 9 done when
- Every visible navigation item opens a usable page.
- No placeholder page is presented to the client as complete.
- Desktop and mobile layouts are reviewed.

---

## Phase 10 — Frontend QA and client demo

Before the demo:
- [ ] Add and edit one Bigari, one Maapvali, and one Patlavale team.
- [ ] Confirm the correct rate field is shown for each type.
- [ ] Mark Bigari attendance and verify its earning.
- [ ] Record Maapvali maaps and verify `maaps × rate`.
- [ ] Record Patlavale production across several days and verify carry-forward.
- [ ] Record Bayana for each type.
- [ ] Record a salary payment for a Patlavale team and verify production/carry do not reset.
- [ ] Check balance calculations against the client-approved accounting rule.
- [ ] Check search, filters, empty states, validation, modals, mobile layout, and navigation.
- [ ] Run `npm run build` from `client/`.
- [ ] Demo the full workflows to the client and write down requested changes.

Do not begin backend integration just because a page looks finished. Get approval for the fields, calculation previews, work history, payment history, and reports.

---

## Phase 11 — UI freeze

After client approval:
1. Commit the approved frontend.
2. Record approved business rules and any remaining open questions in `BUSINESS_RULES.md`.
3. Do not add new business logic during backend integration without updating the rules and tests.
4. Save screenshots or a short demo recording if useful for comparison.
5. Treat changes after this point as explicit change requests.

---

# PART B — BACKEND AFTER FRONTEND APPROVAL

## Phase 12 — Design data models and API contracts

The uploaded ZIP has a `server/` directory, but the server files are empty placeholders. Build backend files after the UI and rules are approved.

Suggested core data entities:
- User / authentication and roles (if required by the client)
- Labour (individual or family/team, with labour type)
- Attendance (Bigari only)
- Rate history or rate snapshots
- Maapvali work entry
- Patlavale production ledger entry
- Season
- Payment / Bayana / advance
- Audit log
- Truck and truck status history (when Trucks phase is approved)

Before coding, decide which fields are stored and which are derived. Financial and production history must remain traceable.

## Phase 13 — Backend setup

Suggested order:
1. `server/package.json`
2. Environment variable validation and `.env.example` (never commit real secrets)
3. Express app and server entry point
4. MongoDB connection
5. Error handling and request validation
6. Health-check endpoint
7. Authentication/authorization if required
8. First API route and model, then repeat feature by feature

Use the frontend's `client/src/services/api.js` as the eventual API boundary. Keep mock data until an endpoint is ready and tested.

## Phase 14 — Backend feature order

Implement and test one feature at a time:
1. Labour CRUD and type-specific validation.
2. Bigari attendance and attendance-based earning calculation.
3. Maapvali work entries and earning calculation.
4. Patlavale production ledger and carry-forward calculation.
5. Payments, Bayana, corrections, and account balance.
6. Labour/team account statement.
7. Dashboard/report endpoints.
8. Trucks and settings if approved.
9. Season close/settlement only after its business rules are confirmed.

For every feature: model → validation → service/business logic → controller → route → API test → frontend integration.

## Phase 15 — Integrate the frontend incrementally

- Replace one mock-data operation at a time with API calls.
- Keep the current UI components where possible.
- Add loading, empty, validation, and error states.
- Verify server calculations against the same examples used in frontend tests.
- Never trust client-submitted calculated totals as the authoritative financial result; validate/recalculate on the server.
- Test that a payment does not modify work or production records.

## Phase 16 — Backup, security, and final verification

- Use environment variables for secrets and database credentials.
- Restrict production database access and protect admin routes.
- Set up scheduled database backups only after the backend/database are operational.
- Test that backups can actually be restored.
- Test all three labour types end to end, including production carry-forward and Bayana.
- Keep an audit trail for financial corrections and production corrections.

---

## 4. Suggested folder structure for the new frontend features

Follow the existing feature-oriented structure rather than reorganizing everything:

```text
client/src/
  features/
    labour/
    attendance/
    payments/
    work/
      maapvali/
    production/
    dashboard/
    salary/
    reports/
  mock/
    labours.js
    attendance.js
    payments.js
    maapvaliWork.js
    production.js
    dashboard.js
  pages/
    Dashboard.jsx
    LabourManagement.jsx
    LabourProfile.jsx
    Attendance.jsx
    Payments.jsx
    MaapvaliWork.jsx
    PatlavaleProduction.jsx
    Salary.jsx
    Trucks.jsx
    Reports.jsx
    Settings.jsx
  utils/
    workCalculations.js
    productionCalculations.js
  validators/
    labourValidator.js
    paymentValidator.js
```

These are suggested additions; reuse the current names and conventions where they already work. Avoid creating duplicate pages/components for the same feature.

---

## 5. Immediate next action — do this first

**Start with Phase 0, then Phase 1. Do not start the backend yet.**

1. Back up/commit the project.
2. Update `BUSINESS_RULES.md`.
3. Add `labourType` and the correct rate fields to mock labour records.
4. Update `LabourForm.jsx` and `labourValidator.js` to conditionally show/validate rates.
5. Update `LabourContext.jsx` so add/edit preserves the new fields.
6. Run the app and build. Fix any regressions before moving on.
7. Only then move to Bigari-only attendance, Maapvali work entry, Patlavale production ledger, payments, profile, and dashboard.

**Work one phase at a time.** Finish the phase checklist, test it, commit it, and only then move forward. Do not try to implement every page or the entire backend in one large change.
