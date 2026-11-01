# BrickPro server

Express API for BrickPro with a MongoDB connection and owner sign-in. There are no business routes or models yet.

Requires Node 20.6 or newer.

## Setup

```bash
cd server
npm install
cp .env.example .env      # then set MONGODB_URI and JWT_SECRET (see below)
npm run create-owner -- --email owner@example.com --name "Your Name"   # creates the sign-in account
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
| `npm run create-owner -- --email <email> --name "<name>"` | Create the owner account (password typed at a hidden prompt). Add `--reset-password` to change an existing password |

The server listens on `http://localhost:5000` by default.

## Environment variables

Loaded from `server/.env` (never committed; `.env.example` is the template).

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `PORT` | `5000` | |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Browser origin allowed by CORS. Comma-separate several, no trailing slash. `*` is rejected in production |
| `MONGODB_URI` | blank | **Required.** Atlas or local connection string including the database name |
| `JWT_SECRET` | blank | **Required.** At least 32 random characters. Signs login tokens; keep it secret |
| `JWT_EXPIRES_IN` | `12h` | Login lifetime: `30m`, `12h`, `7d` ... |
| `COOKIE_SAME_SITE` | `lax` | `lax`, `strict`, or `none` (frontend on a different site; needs HTTPS) |
| `BCRYPT_ROUNDS` | `12` | Password hashing cost, 10 to 15 |
| `TRUST_PROXY` | `0` | Reverse proxies in front of the server (set `1` on most hosts) |

An invalid `NODE_ENV`, `PORT` or empty `CLIENT_ORIGIN` stops the server at start-up with a clear message. So does a missing, malformed, unreachable or wrongly authenticated `MONGODB_URI`; the password is never printed.

## Authentication

The owner signs in with email and password; the server sets an HTTP-only cookie. Every `/api` route except `/api/health` and `/api/auth/login|logout` requires it. Full decisions, setup and the frontend contract: [`docs/AUTH_AND_SECURITY.md`](../docs/AUTH_AND_SECURITY.md).

| Endpoint | Access | Purpose |
|---|---|---|
| `POST /api/auth/login` | public (10 failed tries per IP per 15 min) | Sign in |
| `POST /api/auth/logout` | public | Clear the cookie |
| `GET /api/auth/me` | signed in | Current user |

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
| Unknown route outside `/api`, or unknown `/api` route when signed in | 404 | `Route not found: GET /nope` |
| Not signed in (any private route) | 401 | `Authentication required` |
| Signed in but role not allowed | 403 | `You do not have permission to do this` |
| Too many failed logins | 429 | `Too many login attempts. Please try again later.` |
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
  models/User.js        sign-in account
  services/auth.service.js   hashing, tokens, credential check
  controllers/ routes/       auth and health
  middlewares/           auth, role, validation, rate limit, origin check, error, 404
  validators/            request schemas (Zod)
  scripts/createOwner.js create the owner / reset a password
  utils/                 ApiError, asyncHandler, apiResponse,
                         money (integer paise), dates (business dates, IST), schema (Mongoose helpers)
  tests/
```

Other files in the folder are empty placeholders from the original scaffold and are filled in by later phases.
