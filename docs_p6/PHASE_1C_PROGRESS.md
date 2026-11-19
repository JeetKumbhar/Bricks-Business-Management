# Phase 1C progress (BrickPro / Aayush Carting backend)

Status key: DONE = implemented and tested on the in-memory fake only. "Real-DB verified" is NOT claimed for anything here.

| Item | Status | Notes |
|---|---|---|
| D1 joining-date guard | DONE (approved) | 409 names the earliest conflicting record; Bayana and deleted records never block; transaction kept |
| D2 missing-rate flag | DONE (approved) | flag only; no earnings rewritten; `incomplete`, `missingRate*` on balance, salary rows, statements |
| Census (read-only, TEST db only) | DONE, approved, NOT yet run | `scripts/censusHistorical.js` + `scripts/lib/census.js`; isDeleted check = "not exactly true or false" |
| P6 season concurrency | DONE, revision 2 (stale-delete fix), awaiting review | see below |
| P3 invoice-numbering lock | design approved, NOT implemented | next step, after P6 review |
| P5 autoIndex / indexes | untouched by decision | |
| Overlapping seasons on create | NOT implemented | see FUTURE_season_overlap_race.md |

## P6 - what changed
- `season.service.js`: new `assertSeasonWritable(seasonId, dates, session)`: `Season.updateOne({_id, status: OPEN, startDate <= min(dates), endDate null or >= max(dates)}, {$inc: {revision: 1}}, {session})`; no match => 409.
- `productionEntry.service.js`:
  - `saveDay`: guard is the first operation of the existing required transaction, only when something changes (an unchanged re-send writes nothing and bumps nothing).
  - `correctEntry`: now ONE required transaction: guard(s) + entry update. Date move guards the source season (entry's old date) and the target season (new date), in season-id order; same season => one guard.
  - `deleteEntry`: now ONE required transaction: guard + soft delete. Revision 2: the delete's filter is `{_id, revision, seasonId, date, isDeleted:false}` taken from the entry this request read, so a rival move / edit (or a retried callback holding stale data) gives 409 and rolls back the guard bump; nothing is deleted through a season the entry no longer belongs to.
- `updateSeason` unchanged: its existing `revision` filter returns 409 when a production write bumped the revision after it read the season.
- No restore function exists; no other code writes production entries.

## Tests (fake database only)
- NEW `tests/seasonConcurrency.test.js` (23; 5 added in revision 2: rival moves the entry to another season, retry after a transient conflict with stale data, stale revision, same-season date change, control delete; the test transaction now retries TransientTransactionError like withTransaction): revision bumps, no bump for no-ops, different-day saves, required transactions, closed / re-dated season after read => 409 and nothing saved, source and target season guards on date moves, delete guard, rollback of rows + revision, stale-revision `updateSeason`.
- `tests/helpers/memoryDb.js`: `db.beforeSeasonUpdate` hook (rival commit between read and write).
- `tests/patlavaleHarness.test.js` mock + `scripts/lib/patlavaleHarness.js` T-group hook adapted because a rival correction is now its own transaction (the harness still never connects anywhere).
- Harness review (revision 2): the nested-rival simulation only changes how the rival is recognised (by phase, not by missing session) and treats the rival's whole transaction as an independent commit that survives our rollback; no assertion was removed or loosened. One was added: exactly one nested transaction (`nestedCount === 1`) runs in the T race, so no other nested transaction is silently absorbed. Limitation: that mock does not snapshot the seasons store, so season guard bumps are not rolled back there (rollback of the bump is covered in seasonConcurrency.test.js).
- Mocked only. NOT proven: real MongoDB WriteConflict + withTransaction retry, snapshot isolation, rollback of the revision bump on a real server. Needs a separate, separately approved real-MongoDB test.
