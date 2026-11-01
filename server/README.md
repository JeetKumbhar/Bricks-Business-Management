# BrickPro server

Express API for BrickPro. **Phase 1 only:** the server foundation. There is no database and there are no business routes yet.

Requires Node 20.6 or newer.

## Setup

```bash
cd server
npm install
cp .env.example .env      # then edit if needed
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start with automatic restart on file changes |
| `npm start` | Start for production (`NODE_ENV=production`) |
| `npm test` | Run the tests (Vitest + Supertest) |

The server listens on `http://localhost:5000` by default.

## Environment variables

Loaded from `server/.env` (never committed; `.env.example` is the template).

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `PORT` | `5000` | |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Browser origin allowed by CORS. Comma-separate several, no trailing slash. `*` is rejected in production |
| `MONGODB_URI` | blank | Not used yet (database phase) |
| `JWT_SECRET` | blank | Not used yet (auth phase) |
| `JWT_EXPIRES_IN` | blank | Not used yet (auth phase) |

An invalid `NODE_ENV`, `PORT` or empty `CLIENT_ORIGIN` stops the server at start-up with a clear message.

## API

### Response format

```json
{ "success": true, "message": "Labourers fetched successfully", "data": [] }
```

```json
{ "success": false, "message": "Validation failed", "errors": [] }
```

`errors` appears only when there are details. In development an unexpected 500 also carries a `debug` object; in production it never does.

### `GET /api/health`

```json
{
  "success": true,
  "message": "Server is healthy",
  "data": {
    "status": "ok",
    "environment": "development",
    "uptimeSeconds": 12,
    "timestamp": "2026-11-01T03:30:00.000Z"
  }
}
```

It checks that the process is running. It does not check the database (not connected yet).

### Errors

| Case | Status | `message` |
|---|---|---|
| Unknown route or method | 404 | `Route not found: GET /api/nope` |
| Malformed JSON body | 400 | `Request body is not valid JSON` |
| Body over 1 MB | 413 | `Request body is too large` |
| Anything unexpected | 500 | `Something went wrong on the server` |

## CORS

Browsers calling from a `CLIENT_ORIGIN` get CORS headers. A browser on any other origin gets none and is blocked. Requests without an `Origin` header (curl, uptime checks) are not affected.

## Shutdown

`SIGINT` / `SIGTERM` stop new connections, let running requests finish, then exit. If connections stay open for 10 seconds the process exits anyway. An uncaught error also shuts the server down with a non-zero exit code.

## Structure

```
server/
  app.js                 Express app (createApp), no listening
  server.js              Starts the app, graceful shutdown
  config/env.js          Environment loading and validation
  middlewares/           error + 404 (auth, role, validation stubs are still empty)
  routes/health.routes.js
  utils/                 ApiError, asyncHandler, apiResponse
  tests/
```

Other files in the folder are empty placeholders from the original scaffold and are filled in by later phases.
