# Batch 1B closing fix — labour update atomicity

Files (project-relative; copy over the same paths):
- server/services/labour.service.js              MODIFIED (updateLabour only)
- server/tests/labourUpdateTransaction.test.js   NEW (12 tests)

NOTE: labour.service.js in this ZIP also contains the earlier approved Batch 1B change (atomic labour create). If you already applied
PHASE1B_batch.zip, only the updateLabour block differs: the `try { await labour.save() } ... updateOne(...)` section is replaced by
`saveLabour(session)` + one `runInTransaction(..., { required: true })` that saves the worker and updates the first rate row together.

Behaviour:
- Joining date moved (first rate must move too): worker save + first-rate update in ONE required transaction, both with the same session.
  Any failure rolls both back; no transaction support => HTTP 503 "Nothing was saved", nothing written.
- Any other update (name, village, mobile, status, members, same joining date) changes one document, so it is unchanged: no transaction.
- All validation, authorization, 409/400/404 rules and response shapes are unchanged and still run BEFORE the transaction.

Apply: unzip into the project root (server/ merges), then from server/: npx vitest run tests/labour.test.js tests/labourUpdateTransaction.test.js
No database, index, route, model or frontend change.
