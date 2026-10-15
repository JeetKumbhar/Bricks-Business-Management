# BrickPro — Bulk Daily Maapvali Work & Patlavale Production Update

## Purpose

Update the existing BrickPro frontend so the owner can enter the evening's work for **all Maapvali workers on one page** and **all Patlavale teams on one page**, instead of repeatedly opening an individual “Add Work Entry” / “Add Production Entry” form.

The experience should feel similar to the existing **Attendance** page:
- Show the full relevant worker/team list together.
- Let the owner enter that day's quantity inline for each row.
- Choose the work date once for the whole list.
- Save all entered rows in one action.
- Keep the existing Attendance flow as the UI/UX reference.
- Continue using mock data and frontend state for this phase. **Do not start backend work yet.**

This document is a development specification for the existing project, not a request to rebuild it from scratch.

---

## 1. Business rules to implement

### 1.1 Maapvali

- Maapvali workers are individual workers who transport bricks.
- The owner enters the number of **maaps per worker per day**.
- The unit rate is set per **4 maaps**, not per one maap.
- For calculations, **4 maaps = 1 payable unit = the configured rate for that worker**.
- Therefore:

  `payableUnits = floor(totalMaaps / 4)`

  `earnings = payableUnits × ratePerFourMaaps`

- Example: a worker records 10 maaps and their rate is ₹100 per 4 maaps:
  - Payable units = `floor(10 / 4) = 2`
  - Earnings = `2 × ₹100 = ₹200`
  - 2 maaps remain as a carry-forward remainder if the business wants remainders to accumulate across days.

**Owner decision to confirm:** should Maapvali's leftover maaps (1–3) carry forward across days/entries, or should each day's calculation discard them? Recommended: carry them forward per worker for the season so every 4 maaps eventually count. Do not silently discard remainder quantities.

### 1.2 Patlavale

- Patlavale workers are managed as **teams/families**, not necessarily individual people.
- The owner enters the number of **maaps produced per team per day**.
- **4 maaps = 1,000 payable bricks.**
- The team's rate is configured per **4 maaps / 1,000 payable bricks**.
- Calculation:

  `totalMaaps = previousCarryMaaps + maapsEnteredToday`

  `payableUnits = floor(totalMaaps / 4)`

  `payableBricks = payableUnits × 1000`

  `earningsForEntry = payableUnits × teamRatePerFourMaaps`

  `carryMaaps = totalMaaps % 4`

- Example: a Patlavale team has 2 carry-forward maaps and produces 7 maaps today:
  - Combined maaps = `2 + 7 = 9`
  - Payable units = `floor(9 / 4) = 2`
  - Payable bricks = `2,000`
  - Earnings for this entry = `2 × team rate`
  - Carry forward = `1 maap`

- Carry-forward quantities should accumulate across days and throughout the season. **Salary payments must not reset production, payable totals, or carry-forward quantities.** Reset only through an explicit season-close/reset workflow with confirmation and preserved historical records.
- Keep actual maaps entered, payable units, payable bricks, earnings, and remainder visible/traceable.

### 1.3 Keep Maapvali and Patlavale rules separate

- **Maapvali:** 4 maaps make one rate unit; calculate earnings per 4 maaps. Do not label these as 1,000 bricks unless the owner confirms that applies.
- **Patlavale:** 4 maaps explicitly equal 1,000 payable bricks.
- Do not apply Patlavale's “1,000 payable bricks” label or logic to Maapvali automatically.

### 1.4 Labour records and payments

- All existing workers/teams must remain visible, including rows with zero maaps for the selected date.
- A blank quantity means **not entered yet**, while `0` means the owner explicitly recorded zero work. Keep this distinction clear.
- Rates should come from the worker/team's configured rate. Do not overwrite historical rates when recording daily work.
- Work/production entries and payment records must remain separate.
- Payments affect financial balance according to the approved accounting rules; they must **never** change or reset maap totals, payable units, production totals, or carry-forward.
- Preserve edit/delete behavior if existing entry screens support it, with confirmation for destructive actions.

---

## 2. UX requirements

### 2.1 Shared layout inspired by Attendance

Both daily-entry pages should have:
1. Page title and a one-line instruction.
2. A single date picker at the top, defaulting to today.
3. Summary tiles relevant to the page.
4. Search by worker/team name or ID.
5. Optional filters: `All`, `Not entered`, `Entered`.
6. A list/table containing every active Maapvali worker or Patlavale team.
7. Inline numeric input for that date's maap count.
8. Rate displayed beside each row.
9. Calculated values shown per row.
10. A visible **Save Daily Entries** button.
11. Clear saved/unsaved state and validation feedback.

Use the Attendance page's visual design, spacing, colors, date controls, search, list density, and responsive behavior as the reference. Do not copy attendance status buttons literally; use numeric quantity inputs.

### 2.2 Maapvali Work page

Suggested columns:
- Worker name and ID
- Today's maaps (editable number input)
- Rate per 4 maaps
- Carry-in maaps (previous remainder)
- Payable 4-maap units
- Today's earnings
- Optional note

Top summary tiles:
- Total maaps entered for selected date
- Total completed 4-maap units
- Total estimated earnings for selected date
- Number of workers with entries

Keep selected-date, last-7-days, and all-time totals clearly labelled if these filters are present.

### 2.3 Patlavale Production page

Suggested columns:
- Team/family name and ID
- Today's maaps (editable number input)
- Rate per 4 maaps / 1,000 payable bricks
- Carry-in maaps
- Payable 1,000-brick units
- Payable bricks for this entry
- Today's earnings
- Carry-out maaps
- Optional note

Top summary tiles:
- Maaps entered for selected date
- Payable units / payable bricks for selected date
- Estimated earnings for selected date
- Number of teams with entries

Make the conversion prominent but concise: **4 maaps = 1,000 payable bricks**.

---

## 3. Calculation and carry-forward design

Implement pure calculation helpers in a shared utility module, while keeping the two labour types' semantics explicit. Suggested functions:

```js
export function getMaapvaliCalculation({
  maapsEntered,
  carryInMaaps = 0,
  ratePerFourMaaps,
}) {
  const totalMaaps = carryInMaaps + maapsEntered;
  const payableUnits = Math.floor(totalMaaps / 4);
  const carryOutMaaps = totalMaaps % 4;

  return {
    totalMaaps,
    payableUnits,
    carryOutMaaps,
    earnings: payableUnits * ratePerFourMaaps,
  };
}

export function getPatlavaleCalculation({
  maapsEntered,
  carryInMaaps = 0,
  ratePerFourMaaps,
}) {
  const totalMaaps = carryInMaaps + maapsEntered;
  const payableUnits = Math.floor(totalMaaps / 4);
  const payableBricks = payableUnits * 1000;
  const carryOutMaaps = totalMaaps % 4;

  return {
    totalMaaps,
    payableUnits,
    payableBricks,
    carryOutMaaps,
    earnings: payableUnits * ratePerFourMaaps,
  };
}
```

### Critical implementation detail

Do not calculate carry-in from an unsorted collection or from the currently filtered/search results. Carry-in must be calculated from the selected worker/team's complete chronological history for the active season, before the selected date. Search, filters, and hidden rows must not change calculations.

For a selected date:
- Calculate prior saved entries in date order.
- Calculate carry-in from all prior valid entries in the active season.
- Recalculate that date's entry and subsequent carry-outs in chronological order when an earlier entry is edited/deleted.
- Avoid double-counting the selected date when editing an existing record.
- Prevent duplicate records for the same worker/team and date; saving again should update that date's record rather than create a duplicate.

**Owner decision:** should edits to an older entry recalculate all later carry values? Recommended: yes, to keep remainder and earnings consistent. Preserve an audit trail if the app supports it.

---

## 4. Mock-data-first frontend implementation plan

### Phase 0 — Protect current work

- Create a Git commit or copy the project folder before editing.
- Run the current app and confirm Attendance, Maapvali Work, and Patlavale Production load.
- Do not remove the existing individual “Add Entry” flow until the bulk page works.
- Use mock data / local React context. Do not create APIs or connect MongoDB in this phase.

### Phase 1 — Inspect current patterns

Inspect the Attendance page and components/state, Maapvali Work page and add/edit form, Patlavale Production page and add/edit form, labour/team context and mock data, rate fields and validators, shared date/search/summary/table/input components, and existing edit/delete functions. Reuse project conventions and UI components.

### Phase 2 — Standardize rates and mock records

- Maapvali rate field should consistently mean `ratePerFourMaaps`, labelled “Rate per 4 maaps”.
- Patlavale rate field should consistently mean `ratePerFourMaaps`, labelled “Rate per 4 maaps / 1,000 payable bricks”.
- If existing rates currently mean “per single maap”, do not silently reinterpret them. Update sample values deliberately.
- Keep unique worker/team IDs.
- Add mock entries across at least 3 dates to test carry-forward and editing.

### Phase 3 — Add pure calculation helpers

- Implement and test both calculation functions.
- Validate quantities as finite, non-negative whole numbers.
- Validate rates as finite, non-negative numbers; allow decimals only if the owner uses them.
- Handle blank input separately from explicit zero.
- Test conversion boundaries: 0, 1, 3, 4, 5 and values with a carry-in remainder.

### Phase 4 — Convert Maapvali Work to bulk daily entry

- Replace the main repeated “Add Work Entry” interaction with an attendance-style daily list.
- Keep one date picker for all workers.
- Display every active Maapvali worker.
- Put an inline maap quantity input in each row.
- Show the rate per 4 maaps and calculated earnings.
- Show previous carry-in and carry-out if carry-forward is approved.
- Search/filter without affecting calculations.
- Save all changed rows for the selected date with one action.
- Upsert one record per worker/date in frontend state.
- Keep individual historical entries editable through date selection and inline editing.
- If retaining the single-entry modal, make it secondary.

### Phase 5 — Convert Patlavale Production to bulk daily entry

- Replace repeated “Add Production Entry” interactions with a team list similar to Attendance.
- Display every active Patlavale team/family.
- Use one selected date and one maap count input per team.
- Show rate per 4 maaps / 1,000 payable bricks.
- Show carry-in, payable units, payable bricks, earnings, and carry-out.
- Save all changed team rows for the selected date with one action.
- Upsert one record per team/date and recalculate later carry values after historical edits.
- Keep season totals independent of payments.

### Phase 6 — Summary, history and validation

- Summary tiles must reflect the selected date unless explicitly labelled “All time”.
- Date filters and search must not affect stored totals or carry calculations.
- Show unsaved-change count before saving.
- Warn before navigating away with unsaved changes if the app supports this pattern.
- Show empty states when no active workers/teams exist.
- Validate quantities and show clear messages.
- Ensure responsive usability.

### Phase 7 — Regression test and client demo

Test at minimum:
- Every worker/team appears once.
- Multiple row quantities can be saved in one action.
- Saving again updates rather than duplicates records.
- Blank and zero remain distinct.
- Search/filtering does not change calculations.
- Rates are applied per 4 maaps, not per single maap.
- Patlavale converts each 4 maaps to 1,000 payable bricks.
- Remainders carry forward according to the owner's confirmed rule.
- Editing an earlier date recalculates later carry values.
- Payments do not reset work or production totals.
- Attendance, Payments, Labour Management, Dashboard, and navigation still work.
- Owner can complete evening entries without opening multiple modals.

### Phase 8 — Client approval, then backend

- Demo the frontend using mock data.
- Confirm rate units, carry-forward behavior, and historical-edit behavior with the owner.
- Freeze the approved UI and rules.
- Only then implement backend APIs, MongoDB models, persistence, validation, authorization, and deployment.
- Keep backend work out of this frontend-only task.

---

## 5. Acceptance criteria

The update is complete when:
- Maapvali page lists all active Maapvali workers at once.
- Patlavale page lists all active Patlavale teams at once.
- Owner can enter maap counts for many rows and save once per date.
- Rate is visibly defined per 4 maaps for both pages.
- Patlavale clearly converts 4 maaps into 1,000 payable bricks.
- Per-row earnings and summary totals update immediately.
- Carry-forward is consistent with the owner's confirmed rule.
- Existing Attendance flow remains unchanged.
- No backend is added until the frontend is approved.

## 6. Owner decisions to confirm

1. **Maapvali remainder:** should 1–3 leftover maaps carry forward across days per worker? Recommended: yes.
2. **Patlavale remainder:** confirm 1–3 leftover maaps carry forward per team and 4 maaps always count as 1,000 payable bricks.
3. **Rate unit:** confirm Maapvali rate is per 4 maaps and Patlavale rate is per 4 maaps / 1,000 payable bricks.
4. **Historical edits:** should an older entry recalculate later carry values? Recommended: yes.
5. **Season boundary:** confirm when carry-forward resets, retaining old season records.

---

## Suggested instruction to the coding assistant

> Update the existing BrickPro project according to `BULK_MAAPVALI_PATLAVALE_DAILY_ENTRY_UPDATE.md`. First inspect the current implementation and report the exact files you intend to modify. Keep this frontend-only with mock data and the existing context/state pattern. Make Maapvali Work and Patlavale Production attendance-style bulk daily entry pages: one date picker, all active workers/teams listed, inline maap count per row, visible rate per 4 maaps, live calculations, and one save action for the selected date. Patlavale must calculate 4 maaps = 1,000 payable bricks. Do not start backend work, do not rebuild the project, and do not remove working Attendance functionality. Preserve carry-forward history correctly, and clearly flag any owner decisions that remain unconfirmed.
