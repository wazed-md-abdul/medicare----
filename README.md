# MediCare Connect — Backend

Express + MongoDB REST API for MediCare Connect, a healthcare booking platform (patients book doctors, doctors manage appointments/prescriptions, admins verify doctors).

The entire API lives in a single file: [`src/index.ts`](src/index.ts). It uses the native MongoDB driver (not Mongoose) and verifies auth tokens issued by the frontend's Better Auth server via remote JWKS.

## Tech stack

- **Express 4** — HTTP server
- **mongodb 7** (native driver) — direct collection access, no ODM
- **jose** — JWT verification against the frontend's JWKS endpoint
- **helmet** + **cors** — security / cross-origin
- **TypeScript** (ESM, `"type": "module"`), run with **tsx**
- Deploy target: **Vercel** serverless (`vercel.json`, default export)

## Setup

```
npm install
```

Create `.env` in `backend/`:

```
PORT=5000
MONGO_URI=mongodb://localhost:27017/medicare-connect
FRONTEND_URL=http://localhost:3000
```

- `MONGO_URI` — connection string. Note: code selects the **`test`** database (`client.db("test")`), regardless of the DB name in the URI.
- `FRONTEND_URL` — used for CORS allow-list and to build the JWKS URL (`${FRONTEND_URL}/api/auth/jwks`).

## Commands

```
npm run dev      # tsx watch src/index.ts (hot reload)
npm run build    # tsc -> dist/
npm run start    # node dist/index.js (run build first)
```

No tests configured.

## Authentication

`authenticateJWT` middleware resolves the token from (in order): `req.body.token`, `req.query.token`, or the `Authorization` header (`Bearer <token>` or raw). Valid tokens are verified with `jose.jwtVerify` against the frontend's remote JWKS. On success `req.user = { id, email, role, name }` is populated from the JWT claims.

**Dev-mode bypasses** (present in current code — no real token required):
- `x-user-id` + `x-user-role` headers — looks up that user in the `users` collection, else fabricates a user.
- No token at all — falls back to the first user in the `users` collection, or a mock `admin` user.

> Warning: these fallbacks grant access without a valid token. Remove or gate them before any production deployment.

`restrictTo(...roles)` guards routes by role. Roles: `patient`, `doctor`, `admin`.

## Data model (MongoDB collections)

Native driver, no schemas. Collections used:

- `users` — `{ _id (string), name, email, role }` (written by the frontend's Better Auth)
- `doctors` — `{ user (users._id), specialization, biography, hospital, experience, consultationFee, availability: [{day, slots[]}], rating, reviewsCount, isVerified, gallery }`
- `appointments` — `{ patient, doctor (doctors._id), date, time, symptoms, status }` — status: `pending | accepted | rejected | completed`
- `prescriptions` — `{ appointment, doctor, patient, medicines, instructions }`
- `reviews` — `{ doctor, patient, ... }`
- `items` — generic per-user catalog items

Relations are joined manually in code (fetch IDs, map back onto results) since there's no ODM populate.

## API routes

Base URL: server root. All under `/api` except `/health`.

### Health
- `GET /health` — service + DB status

### Doctors
- `GET /api/doctors` — list verified doctors. Query: `search`, `specialization`, `experience`, `maxFee`, `availability`, `sortBy` (`rating|fee|experience`), `page`, `limit`
- `GET /api/doctors/:id` — single doctor + reviews
- `GET /api/doctors/profile` — **doctor** — own profile (lazy-creates placeholder if missing)
- `PUT /api/doctors/profile` — **doctor** — upsert own profile
- `GET /api/doctors/unverified` — **admin** — all doctor profiles
- `PUT /api/doctors/:id/verify` — **admin** — set `isVerified` (body `{ isVerified }`)

### Appointments
- `POST /api/appointments` — **patient** — book (`{ doctorId, date, time, symptoms }`); validates slot against doctor availability, rejects double-booking (409)
- `GET /api/appointments` — list, scoped by role (patient → own, doctor → their bookings, admin → all)
- `PUT /api/appointments/:id/status` — update status (`accepted|rejected|completed`); patients may only cancel (reject)
- `DELETE /api/appointments/:id` — delete (owner patient / assigned doctor / admin)

### Prescriptions
- `POST /api/prescriptions` — **doctor** — create (`{ appointmentId, medicines, instructions }`); marks appointment `completed`
- `GET /api/prescriptions/:appointmentId` — fetch by appointment

### Dashboard
- `GET /api/dashboard/stats` — role-specific stats + recent activity (patient / doctor / admin branches)

### Items
- `GET /api/items` — current user's items
- `POST /api/items` — create (`{ title, shortDescription, fullDescription, price, imageUrl }`)
- `DELETE /api/items/:id` — delete own item

## CORS

Allows `FRONTEND_URL`, `localhost:3000/3001`, and any `*.vercel.app` origin. Requests with no origin (curl/Postman/server-side) are allowed.

## Deployment (Vercel)

`vercel.json` builds `src/index.ts` with `@vercel/node` and routes everything to it. When `process.env.VERCEL` is set, `app.listen` is skipped and the default export is used as the serverless handler. The Mongo client is cached across invocations (`cachedClient` / `cachedDb`) to survive cold/warm starts.
