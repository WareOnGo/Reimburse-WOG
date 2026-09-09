# Employee Reimbursement Portal

Internal Wareongo app for raising, tracking and approving employee expense reimbursements.
Employees sign in with their work Google account, submit a ticket with receipts attached, and
follow it through review; Finance/admins review submissions, approve (fully or partially),
and mark them cleared once paid.

Built with Next.js 16 (App Router, React Server Components), Prisma on a shared Supabase
Postgres, Cloudflare R2 for attachments, and Resend for notification email.

---

## Stack

| Concern    | Choice |
| ---------- | ------ |
| Framework  | Next.js 16 App Router, React 19, server components by default (`dynamic = "force-dynamic"` on authed pages) |
| Language   | TypeScript, `@/*` path alias to repo root |
| Styling    | Plain CSS in `app/globals.css` — no framework. Wareongo palette (navy + orange), mobile-first |
| Database   | Postgres (Supabase) via Prisma 5 |
| Files      | Cloudflare R2 (S3-compatible), browser uploads direct via presigned PUT |
| Auth       | Hand-rolled Google OAuth 2.0 + httpOnly session cookie. No NextAuth |
| Email      | Resend HTTP API (no SDK) |
| Tests      | Vitest (Node + jsdom), Testing Library, disposable Postgres, Playwright |

---

## How it works

### Authentication and identity

There is no password and no local user table of record. Identity comes from the shared
`VerifiedNumber` table that other Wareongo apps also use.

1. `GET /api/auth/google` sets a random `rp_oauth_state` cookie and redirects to Google.
2. `GET /api/auth/google/callback` verifies `state`, exchanges the code, and reads the
   profile from Google's userinfo endpoint. The email must be `email_verified`.
3. The email is looked up in `VerifiedNumber`. **No row, or no `empID` on the row → sign-in is
   refused** (`?error=not_on_file`). `is_active = false` → refused (`?error=inactive`).
4. An `Employee` row is upserted for that `empID`. `rp_session` contains a random 256-bit
   token (httpOnly, SameSite=Lax, Secure in production, 30 days). Only its SHA-256 hash,
   email and server-enforced expiry are stored in `ReimbursementSession`. Plain email
   cookies are rejected; signing out revokes the server session.

`lib/auth.ts` resolves the cookie into a `CurrentUser` on every request — `getCurrentUser()`
(React-`cache`d per request), plus `requireUser()` / `requireAdmin()` which redirect. **Admin is
an env allowlist**: an email in the comma-separated `ADMIN_EMAILS` gets `isAdmin: true`. The
`Employee.role` column exists but is not what gates admin access today.

Onboarding a new employee is therefore a data task, not a code one: they need a
`VerifiedNumber` row with their work email and an `empID`.

### Ticket lifecycle

```
PENDING ──► REVIEW ──► APPROVED ──► CLEARED
   │                       │
   ├──────► REJECTED ◄─────┘
   │
   └──────► CANCELLED   (employee, while pending/review)
```

- **Employees** may edit or cancel their own ticket only while it is `PENDING` or `REVIEW`.
  Anything further along is read-only and the API returns `409`.
- **Admins** drive every other transition from `/admin`, including reopening (`→ PENDING`),
  reverting a cleared ticket, and restoring a cancelled one.
- Every transition appends a `TicketEvent` row as an audit trail. Event writes are
  best effort and awaited — a failed audit insert never fails the request.

### Partial approval

`Ticket.amount` is what the employee asked for; `Ticket.approvedAmount` is what Finance
sanctioned. The convention throughout the code is:

- `approvedAmount = null` → **full** approval of `amount`. This is also what a plain approve writes.
- `approvedAmount = n` where `0 < n < amount` → **partial** approval; the `amount - n` remainder
  is treated as rejected money in the admin rollup.
- Passing `approvedAmount === amount` collapses to `null` (a full approval), so the two never
  disagree.

Reverting `CLEARED → APPROVED` without an explicit `approvedAmount` deliberately *preserves*
the existing partial rather than silently promoting it to a full approval.

A partial approval emails the employee via Resend. The send is debounced on content — it only
fires when the sanctioned amount actually changed — so re-confirming the same partial doesn't
resend. It is `await`ed (so serverless doesn't cut it off) but `sendPartialApprovalEmail` never
throws, so mail trouble can't break the API response.

### Attachment upload

Uploads go browser → R2 directly; the app server only signs.

1. Client compresses the file if it's a re-encodable image ≥300 KB — bounded to 1800 px at
   JPEG q0.82, which typically shrinks a phone photo 10–20× (`app/_components/upload.ts`).
2. `POST /api/r2/sign` (auth required) returns a presigned PUT URL valid 300 s, keyed
   `tickets/employees/<encoded-empID>/<ticketId|draft>/<uuid>-<safe-filename>`.
3. Client `PUT`s the bytes with progress, a 120 s timeout, and up to 3 attempts with backoff.
   Every attempt re-signs. HTTP 408/429 and 5xx retry; other 4xx and explicit aborts fail fast.
4. Client posts the ticket with `attachments[]` referencing the returned `r2Key`. The server
   validates the employee namespace, image/PDF metadata, 25 MiB limit and actual object byte
   count before associating it. Previously linked attachments keep their existing keys.

Two deliberate quirks worth knowing before you "fix" them, both documented at their call sites:

- **`ContentType` is intentionally not part of the signed PUT command.** Signing it makes
  `content-type` a SigV4 signed header, and mobile browsers / in-app webviews / proxies that
  rewrite the header caused device-specific 403 `SignatureDoesNotMatch` failures.
- **Downloads pin `ResponseContentType`** from the DB row instead, so previews render inline
  correctly regardless of what was stored at upload time.

Reads never expose the bucket: `GET /api/attachments/[id]/url` checks that the caller owns the
parent ticket (or is an admin) and returns a 300 s presigned GET.

---

## Routes

### Pages

| Route | Who | What |
| ----- | --- | ---- |
| `/` | public | Google sign-in. Redirects signed-in users to `/admin` or `/dashboard`. Renders OAuth failures as friendly copy |
| `/dashboard` | employee | Pending / approved / cleared stat cards over your own tickets, plus a filterable list |
| `/dashboard/new` | employee | Raise a ticket — title, category, amount, expense date, description, multi-file drag-and-drop |
| `/dashboard/tickets/[id]` | owner | Ticket detail, attachments, event timeline, edit + cancel actions. Accepts id or `shortCode` |
| `/dashboard/tickets/[id]/edit` | owner | Edit while pending/review; add and remove attachments |
| `/admin` | admin | Per-employee rollup table + full ticket table with status/employee/text filters, review dialog and attachment previews |

Categories are a fixed client-side list in `TicketForm.tsx`: Travel, Meals, Software,
Office Supplies, Other.

### API

| Endpoint | Notes |
| -------- | ----- |
| `GET /api/tickets` | Your tickets; admins get all |
| `POST /api/tickets` | Create. Validates fields and a non-negative finite amount, assigns `shortCode`, nests attachments |
| `PATCH /api/tickets/[id]` | One endpoint for both employee edits and admin status changes; authorization branches on which fields are present. Accepts id or `shortCode` |
| `POST /api/r2/sign` | Presigned upload URL. Auth required |
| `GET /api/attachments/[id]/url` | Presigned download URL. Owner or admin only |
| `GET /api/auth/google` · `GET /api/auth/google/callback` · `POST /api/auth/logout` | OAuth + session |

All API routes are `runtime = "nodejs"` (Prisma and the AWS SDK need it).

---

## Layout

```
app/
  page.tsx                    login
  layout.tsx  globals.css
  _components/                shared UI — TicketForm, TicketCard, HistoryFilter,
                              AttachmentLink, ConfirmDialog, UserMenu, Icons, Skeletons
    upload.ts                 client upload pipeline (compress → sign → PUT → retry)
  dashboard/                  employee area (layout calls requireUser)
  admin/                      admin area (layout calls requireAdmin)
    _components/              AdminEntriesTable, AdminReviewDialog, AdminActions
  api/                        route handlers
lib/
  auth.ts                     session cookie ↔ CurrentUser, requireUser/requireAdmin
  prisma.ts                   HMR-safe PrismaClient singleton + dev query logging
  r2.ts                       presign upload/download, delete, head, key builder
  email.ts                    Resend transport + partial-approval template
prisma/schema.prisma
```

---

## Getting started

```bash
npm install          # postinstall runs `prisma generate`
cp .env.example .env # then fill it in — see below
npm run dev          # http://localhost:3000
```

To actually sign in locally you need a Google OAuth client with
`http://localhost:3000/api/auth/google/callback` registered as an authorized redirect URI, and
a `VerifiedNumber` row whose `email` matches your Google account and which has an `empID`. Put
that same email in `ADMIN_EMAILS` to see `/admin`.

### Environment

| Variable | Purpose |
| -------- | ------- |
| `DATABASE_URL` | Supabase **transaction pooler** (port 6543) with `?pgbouncer=true&connection_limit=1` |
| `DIRECT_URL` | Supabase direct connection (port 5432). Prisma migrations only |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | R2 credentials |
| `R2_BUCKET` | Bucket name |
| `R2_ENDPOINT` | Optional S3-compatible endpoint for local testing; omit for Cloudflare R2 |
| `R2_PUBLIC_BASE_URL` | Optional. Only used by the `publicUrl()` helper; normal downloads are presigned |
| `ADMIN_EMAILS` | Comma-separated admin email allowlist |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | OAuth client. Redirect URI must match Google exactly |
| `RESEND_API_KEY`, `RESEND_FROM` | Email. `RESEND_FROM` must be a verified Resend sender/domain. Unset ⇒ sends are skipped with a warning, not an error |
| `RESEND_REPLY_TO` | Optional |
| `APP_BASE_URL` | Builds the "View in portal" link in emails |

Get an R2 name wrong and the client throws `Missing env: R2_BUCKET` on the first
sign/upload/download rather than at boot — the S3 client is constructed lazily.

### R2 CORS

The browser `PUT`s straight to the presigned URL, so the bucket needs a CORS rule:

```json
[{
  "AllowedOrigins": ["http://localhost:3000", "https://your-prod-domain.com"],
  "AllowedMethods": ["PUT", "GET"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["ETag"]
}]
```

### Database — read this before touching the schema

**This Postgres instance is shared with other Wareongo apps.** `prisma/schema.prisma` is
introspected from the whole database, so most of what's in it (`Warehouse`, `WarehouseData`,
`Enquiry`, `Draft`, `MessageLog`, `opportunities`, `audit_logs`, …) belongs to other services.
This app owns only:

- `Employee`, `Ticket`, `Attachment`, `TicketEvent`, `ReimbursementSession`
- enums `TicketStatus`, `AttachmentKind`
- and it *reads* `VerifiedNumber` for identity

Consequences:

- **Never run `prisma db push` or `prisma migrate`.** Against a shared database Prisma will try
  to reconcile tables it doesn't own — including dropping columns and objects it can't
  represent. The `db:push` / `db:migrate` scripts were deliberately removed from
  `package.json` so nobody runs one by reflex. Make additive changes with `prisma db execute`
  (or plain SQL against the DB), then update `schema.prisma` to match and re-run
  `prisma generate`.
- Several models carry row-level security and expression/GIN indexes that Prisma itself flags as
  needing extra migration setup — another reason to hand-write the SQL.
- `npm run db:studio` is safe and useful for browsing.

---

## Testing and CI

```bash
npm test                  # fast Node/jsdom unit and handler tests, no services
npm run test:watch
npm run test:coverage     # complete source inventory + enforced coverage gates
npm run test:mutations    # eight targeted regression checks in a temporary copy
npm run lint -- --max-warnings=0
npm run typecheck         # generate Next route types, then tsc --noEmit
npm run build
npm run test:integration  # starts and removes its own local Postgres
npx playwright install chromium
npm run test:e2e          # disposable Postgres + local storage + actual Next pages
```

Use Node 22. `npm ci` installs the committed versions and generates Prisma without connecting
to a database. The integration/browser scripts use `embedded-postgres`; its platform binary
and postinstall scripts must be available. They need permission to bind loopback ports.
On Linux, Playwright may require `npx playwright install --with-deps chromium`; an existing
`/usr/bin/google-chrome` is used automatically, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

The service harness creates a fresh `erp_test` database under the OS temporary directory,
generates local credentials, and overrides database/provider settings. It never accepts a
caller-supplied database URL or loads `.env`. Browser tests issue opaque sessions directly in
the disposable DB; OAuth provider exchanges are covered separately with mocked HTTP. The
local storage fixture exercises real presigning, uploads, metadata and preview requests, but
does not validate AWS signatures. No real Google, Resend or Cloudflare account is needed.

Vitest has separate `server` (Node) and `ui` (jsdom) projects. Server tests use real route
handlers and Request/Response objects with mocked infrastructure. Financial/date/validation
rules are tested through production helpers. Integration checks use real Prisma/Postgres for
concurrency, rollback, relations, Decimal values and sessions. Browser checks cover routing,
permissions, employee/finance flows, receipt uploads, logout and keyboard navigation.

Coverage includes every `app/` and `lib/` TypeScript source file, including pages and unused
legacy components. Unit coverage does not include browser/integration execution. Open
`coverage/index.html`; machine-readable reports are `coverage/lcov.info` and
`coverage/coverage-summary.json`. Global gates are 80% lines/statements and 75% branches/functions.
Critical auth/domain/API files have individual 95% lines/statements/functions and 90% branches
gates; active form/upload/admin modules have individual 90% lines/statements/functions and 85%
branches gates. Raise the gates as coverage grows; do not exclude untested files to satisfy them.

CI runs lint, generated-type checks, unit coverage, a production build, isolated database tests
and Chromium browser tests on Node 22. It retains coverage and browser failure artifacts for
14 days. The targeted mutation command is an additional local check of assertion strength,
not an exhaustive mutation-testing score.

See [UNIT_TEST_AUDIT.md](UNIT_TEST_AUDIT.md) for the original audit and
[TEST_IMPLEMENTATION.md](TEST_IMPLEMENTATION.md) for implementation results and limitations.

### Deploying the session change

Before deploying this version, apply the additive
[session SQL](prisma/sql/20260910_portal_sessions.sql) through the approved shared-database SQL
process, then generate Prisma with `npm ci` or `npx prisma generate`. The new session model
requires this table. **Do not run `prisma db push` or `prisma migrate`.** The SQL was applied via
`prisma db execute` and verified on the configured shared database on 10 September 2026; see
[TEST_IMPLEMENTATION.md](TEST_IMPLEMENTATION.md). Additional environments still require the SQL.
The SQL enables row-level security without browser policies. The server connection must use
the trusted table owner or a `BYPASSRLS` role; Supabase `anon`/`authenticated` roles must never
read or create sessions directly.

Existing email cookies will require users to sign in again. Coordinate deployment so older
instances that still trust email cookies are removed. Existing in-progress uploads using old
unscoped keys need to be selected/uploaded again. Historical linked receipts remain readable.
Expired session rows do not authenticate; schedule deletion of rows whose `expiresAt` is in
the past if retention grows. No cleanup scheduler is installed by this change.

---

## Implementation notes

- **`shortCode` allocation** uses a transaction-scoped Postgres advisory lock and the highest
  numeric `RB-` suffix, starting at `RB-2001`. Allocation and creation commit together; legacy
  malformed codes do not influence the next number. All writers must use this allocation path.
- **Ticket changes** use an optimistic `updatedAt`/status condition. Conflicting edits return
  `409` with a refresh/retry message. Attachment row removal and ticket changes commit in one
  transaction; R2 cleanup happens after commit.
- **Validation** rejects malformed object shapes, inherited/unknown status names, blank required
  fields, invalid calendar dates, and amounts outside Decimal(12,2) or with more than two decimal
  places. Zero requested amounts remain supported. Mixed edit/approval requests validate approval
  against the new requested amount. Category remains a nonempty string for legacy compatibility.
- **Deleted attachments** are removed from Postgres and then best-effort deleted from R2. A
  failed R2 delete leaves an orphaned object; nothing sweeps those up yet.
- `/admin` presigns a download URL for every attachment on every render, so page cost grows with
  total attachment count. Worth paginating before the ticket table gets long.
