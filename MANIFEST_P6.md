# Phase 1C - P6 (season concurrency) patch, REVISION 2. Paths relative to repo root. Fake-database tests only.
MODIFIED: server/services/season.service.js, server/services/productionEntry.service.js (rev 2: deleteEntry filter includes revision, seasonId, date),
 server/tests/helpers/memoryDb.js (db.beforeSeasonUpdate hook), server/scripts/lib/patlavaleHarness.js, server/tests/patlavaleHarness.test.js (adds nestedCount assertion)
NEW: server/tests/seasonConcurrency.test.js (23 tests)
DOCS: docs_p6/PHASE_1C_PROGRESS.md, docs_p6/FUTURE_season_overlap_race.md
No database, index, config, frontend or other change. Nothing was run against any database.
