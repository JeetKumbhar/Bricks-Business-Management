# Phase 1C Stage 2 patch (paths relative to repo root)
NEW: server/tests/legacyCompat.test.js, server/tests/census.test.js, server/scripts/censusHistorical.js, server/scripts/lib/census.js
MODIFIED: server/services/labour.service.js (D1 guard), server/services/balance.service.js, server/services/salary.service.js, server/services/salaryCalculations.js (D2 flags),
 server/tests/labour.test.js, server/tests/labourUpdateTransaction.test.js (model mocks), server/tests/payment.test.js, server/tests/salary.test.js (additive fields in 2 strict assertions)
Apply: copy over the same paths. No DB, index, config or frontend change.
Census (YOU run it, TEST DB only, read-only), from server/ in PowerShell:
  node scripts\censusHistorical.js --read-only-census --confirm-db aayush_carting_test --confirm-host aayush-carting.7xmegwh.mongodb.net
