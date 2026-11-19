# Phase 1C - P3 (invoice numbering lock) patch. Paths relative to repo root. Fake-database tests only. Apply AFTER the approved P6 rev2 patch.
MODIFIED: server/models/InvoiceSettings.js, server/services/invoiceSettings.service.js, server/services/bill.service.js (1 line),
 server/tests/bill.test.js (1 test edited), server/tests/helpers/memoryDb.js (cumulative file: includes the P6 season hook + the P3 settings fake)
NEW: server/tests/invoiceNumberingLock.test.js (24 tests)
DOCS: docs_p3/PHASE_1C_PROGRESS.md (replaces docs_p6 copy), docs_p3/FUTURE_season_overlap_race.md
No database, index, config, frontend or P6 service change. Nothing was run against any database.
