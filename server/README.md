# BrickPro server

Express API for BrickPro, with a MongoDB connection (Phase 2). There are no business routes or models yet.

Requires Node 20.6 or newer.

## Setup

```bash
cd server
npm install
cp .env.example .env      # then set MONGODB_URI (see below)
```

### Database

`MONGODB_URI` is required. The server connects first and exits with a clear message if it cannot, so nothing is served without a database.

- **Atlas:** create a free cluster, add a database user, add your IP under Network Access, then copy the `mongodb+srv://...` string into `.env` with a database name, e.g. `...mongodb.net/brickpro?retryWrites=true&w=majority`.
- **Local:** `docker run -d --name brickpro-mongo -p 27017:27017 mongo:7`, then `MONGODB_URI=mongodb://127.0.0.1:27017/brickpro_dev`.

Step-by-step notes, error meanings, and the money and date rules are in [`docs/DATABASE_CONVENTIONS.md`](../docs/DATABASE_CONVENTIONS.md).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start with automatic restart on file changes |
| `npm start` | Start for production (`NODE_ENV=production`) |
| `npm test` | Run the tests (Vitest + Supertest). They need no database |

The server listens on `http://localhost:5000` by default.

## Environment variables

Loaded from `server/.env` (never committed; `.env.example` is the template).

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `PORT` | `5000` | |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Browser origin allowed by CORS. Comma-separate several, no trailing slash. `*` is rejected in production |
| `MONGODB_URI` | blank | **Required.** Atlas or local connection string including the database name |
| `JWT_SECRET` | blank | Not used yet (auth phase) |
| `JWT_EXPIRES_IN` | blank | Not used yet (auth phase) |

An invalid `NODE_ENV`, `PORT` or empty `CLIENT_ORIGIN` stops the server at start-up with a clear message. So does a missing, malformed, unreachable or wrongly authenticated `MONGODB_URI`; the password is never printed.

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
    "database": { "status": "connected", "name": "brickpro" },
    "uptimeSeconds": 12,
    "timestamp": "2026-11-01T03:30:00.000Z"
  }
}
```

It pings the database. If the database is not connected (or does not answer), the response is `503` with `success: false`, `data.status: "degraded"` and `data.database.status` set to `disconnected`, `connecting`, `disconnecting` or `unreachable`.

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

`SIGINT` / `SIGTERM` stop new connections, let running requests finish, close the database connection, then exit. If connections stay open for 10 seconds the process exits anyway. An uncaught error also shuts the server down with a non-zero exit code.

## Structure

```
server/
  app.js                 Express app (createApp), no listening
  server.js              Starts the app, graceful shutdown
  config/env.js          Environment loading and validation
  config/db.js           MongoDB connection, status, readable errors
  middlewares/           error + 404 (auth, role, validation stubs are still empty)
  routes/health.routes.js
  utils/                 ApiError, asyncHandler, apiResponse,
                         money (integer paise), dates (business dates, IST), schema (Mongoose helpers)
  tests/
```

Other files in the folder are empty placeholders from the original scaffold and are filled in by later phases.
