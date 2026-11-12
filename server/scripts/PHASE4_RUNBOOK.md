# Phase 4 runbook: real backend + TEST Atlas + browser (Windows PowerShell)

Status: NOT RUN YET. The workspace that prepared this kit cannot reach MongoDB Atlas and has no TEST database or `.env`. Everything below is for YOU to run on your machine. All commands are PowerShell (no Git Bash or WSL needed). Open two PowerShell windows (A = backend, B = checks) in the project folder.

## 0. One-time TEST database setup (Atlas)
1. In Atlas create a SEPARATE database user and (ideally) a separate cluster. The database NAME must END with `_test`, for example `brickpro_test` (names such as `prodtest` or `brickpro_test_backup` are refused by the script). Use a NEW password, never the production one, and a user that cannot reach production data.
2. Create `server\.env` (local file, never committed; Notepad is fine) with:
   ```
   MONGODB_URI=mongodb+srv://<testuser>:<testpass>@<cluster-host>/brickpro_test?retryWrites=true&w=majority
   JWT_SECRET=<a long random value>
   CLIENT_ORIGIN=http://localhost:5173
   NODE_ENV=development
   ```
   (URL-encode special characters in the password.)
3. Create a TEST owner. This WRITES to the database in `.env`. The script refuses unless NODE_ENV is not production, the database name ends with `_test`, and you pass `--confirm-db` with that exact name (it checks all this before asking for a password or connecting; there is no bypass, and the real production owner is created by a separate procedure, not this script). First clear any leftover connection string in this window so that `server\.env` is the only source:
   ```powershell
   Remove-Item Env:MONGODB_URI -ErrorAction SilentlyContinue
   cd server
   node scripts\createOwner.js --email testowner@aayush.local --name "Test Owner" --confirm-db brickpro_test
   ```
4. Indexes: the check script only READS them and stops if they are missing. If it reports a missing index, run `node scripts\syncIndexes.js` ONLY while `.env` points at the TEST database, then run the check again.

## 1. Backend + database lifecycle check (Checkpoints A and B)
Window A (leave running):
```powershell
cd server
npm run dev
```
Window B:
```powershell
cd server
$env:PHASE4_CONFIRM_DB = "brickpro_test"                 # must equal the database name in MONGODB_URI
$env:OWNER_EMAIL = "testowner@aayush.local"
$secure = Read-Host "Owner password" -AsSecureString       # typed hidden
$env:OWNER_PASSWORD = [System.Net.NetworkCredential]::new("", $secure).Password
node scripts\verifyPhase4.js --i-understand-this-writes-test-data --set-test-settings
```
When finished, clear the secrets from this window:
```powershell
Remove-Item Env:OWNER_PASSWORD, Env:OWNER_EMAIL, Env:PHASE4_CONFIRM_DB
```
Optional environment variables if your ports differ: `$env:API_BASE = "http://localhost:5000/api"` and `$env:CLIENT_ORIGIN_FOR_TEST = "http://localhost:5173"` (must be listed in `CLIENT_ORIGIN` of the backend).
`--set-test-settings` is needed once if the TEST invoice settings have no seller name/address/GSTIN/state (it only runs when they are missing).

### What the script does BEFORE it writes anything
1. Refuses `NODE_ENV=production`, a database name that does not END with `_test` (case-insensitive), and a missing or different `PHASE4_CONFIRM_DB`.
2. Asks the running backend `GET /api/health` (no login, no write). The backend must report the SAME database name and must not be in production mode. If not, it stops with only that one request made.
3. Connects to the TEST database and reads the indexes. Missing index: stop.
4. Logs in (the first write: the login's last-login time, now known to be on the TEST database).
5. Compares, read-only, the customer total seen through the backend with the total in the database. Different: stop.
Only then are test records created. Limit: step 2 proves the database NAME, not the cluster. Keep the TEST user unable to reach production.

### Critical vs ordinary checks
`[critical]` checks halt the run immediately (safety, identity, login, indexes, and every create that later steps need: customers, truck, Pheeras, drafts, rates, finalize, cancel). The output then says "HALTED at a critical check" and nothing further runs. Other checks (for example refusals and database-state assertions) are reported PASS/FAIL and the run continues. Exit code is 1 if anything failed.

It checks over HTTP and then directly in MongoDB: UNBILLED start, NOT_BILLABLE internal, voided and historical-null refusals, mixed customers refused, UNBILLED to RESERVED, same requestId replay, reserved Pheera refused for a second draft, two simultaneous attempts (one wins), remove releases, add with current and stale revision, discard releases, pricing (1000 bricks at 5500 per 1000 plus 4.5 t at 700 plus 5% GST), HSN refusal, finalize to BILLED with a unique number, finalized not editable or discardable, billed Pheera not re-billable, server PDF, cancel does NOT release, release after cancel. It never deletes, drops, migrates or syncs indexes.

Send me the console output (it contains no secrets).

## 2. Browser checklist (Checkpoint C)
See `server\scripts\PHASE4_BROWSER_CHECKLIST.md`. Start the front end in a third window with `cd client; npm run dev`.

## What was actually run when this kit was prepared (no database, no real backend)
- Script syntax check, and safety-gate runs with dummy values: missing flag, missing credentials, missing connection string, database names `brickpro`, `prodtest`, `brickpro_test_backup`, `test_brickpro`, `Brickpro_TEST_` (all refused), no database name, missing or wrong confirmation, production mode.
- Two runs against a tiny FAKE local server that only logs requests: one reporting a different database name, one reporting production mode. In both, the script halted after the single `GET /api/health` request; no login and no write was sent.
- NOT run: anything against a real database, the real backend, or a browser.

## Known limitation to keep
POST /bills/:id/trips (add Pheeras to a draft) has no server idempotency key. The UI never re-sends an unsure add by itself: it re-reads the draft first.
