# Unit test audit implementation

Implemented on 10 September 2026 following approval of [UNIT_TEST_AUDIT.md](UNIT_TEST_AUDIT.md).
The original audit remains a historical snapshot of commit `71cb6eddbcda7b5c52b848017496159794db3464`;
its findings and baseline measurements have not been rewritten to describe the new code.

## Outcome

The suite now tests authentication, HTTP authorization, runtime validation, approval amounts,
financial totals, storage/email contracts, employee forms and finance interactions. It also
includes real database and browser checks for behavior that mocked units cannot establish.
The confirmed application defects from the audit have been fixed alongside their regressions.

**Database prerequisite completed on 10 September 2026:** applied
[prisma/sql/20260910_portal_sessions.sql](prisma/sql/20260910_portal_sessions.sql) to the configured
shared Supabase database through `prisma db execute --file prisma/sql/20260910_portal_sessions.sql
--schema prisma/schema.prisma`, following explicit approval. Read-only Prisma verification confirmed
the three column definitions, token primary key, expiry index, enabled row-level security with no
policies, and access through the application's database role and generated session model.
The application has not been deployed.

## Verification

| Check | Result |
| --- | --- |
| Original audit baseline | 26 passing tests in 3 files; no usable coverage report |
| Unit and handler suite | 373 passing tests in 13 files |
| Source inventory | All 45 application TypeScript files in `app/` and `lib/` included |
| Database integration | 11 passing tests, including real transaction races/rollback, token replay and session-table RLS |
| Chromium browser journeys | 5 passing journeys through actual pages, routes, cookies and local uploads |
| Targeted mutations | All 7 previously surviving mutations detected, plus the timeout control |
| Lint | `npm run lint -- --max-warnings=0` passes |
| TypeScript | Generated Next route types and `tsc --noEmit` pass |
| Production build | `npm run build` passes on Next 16.3.4 |
| Clean install | `npm ci` with npm 10.9.4 in a fresh temporary directory passes; Prisma client generated |
| Dependency advisories | Clean install reports 0 known npm vulnerabilities at verification time |
| Harness failure propagation | An intentionally invalid test-runner option produces process exit 1 after database cleanup |

Tests and reports were run locally; GitHub Actions has been configured but has not been executed
on a remote branch by this implementation. Browser tests run the actual Next development server;
the production build is verified separately. The build downloads Manrope through `next/font`,
so it still needs access to Google Fonts. The first sandboxed build failed that download; the
network-enabled build passed without changing the font or disabling checks.

### Measured unit coverage

| Metric | Covered / total | Percentage | Global gate |
| --- | --- | --- | --- |
| Lines | 809 / 982 | 82.38% | 80% |
| Statements | 959 / 1162 | 82.53% | 80% |
| Branches | 787 / 998 | 78.85% | 75% |
| Functions | 222 / 280 | 79.28% | 75% |

These figures are unit coverage only: database/browser execution is not merged into them.
An untested file remains in the denominator. There was no measured percentage before this work,
so the audit's missing coverage should not be represented as a measured 0% baseline.

All API handlers and the auth, attachment-access, validation, ticket-policy, totals and email
modules have 100% line coverage. Their individual branch coverage is at least 90%. Active form,
upload and admin interaction modules exceed the configured interaction gates.

`vitest.config.ts` discovers every API `route.ts` and gives each file its own threshold entry.
Critical files require 95% lines/statements/functions and 90% branches. Each active form/upload/
admin review/table file requires 90% lines/statements/functions and 85% branches. This avoids
averaging a poorly tested handler into a well-tested group. The complete repository also has
the global gates above.

Generated artifacts: `coverage/index.html`, `coverage/lcov.info`, and
`coverage/coverage-summary.json`. CI retains coverage and browser reports for 14 days.

## Confirmed audit defects addressed

| Finding | Implementation | Regression evidence |
| --- | --- | --- |
| F1: plain-email cookies permit identity forgery | Cryptographically random 256-bit session token; only SHA-256 hash, email and expiry stored server-side. Expiry is checked on requests; logout and reauthentication revoke previous browser tokens. Cookie is httpOnly, SameSite=Lax, Secure in production. Session table uses RLS with no browser policies. | Auth units reject legacy, forged, absent, expired and revoked cookies; eligible identity and admin allowlist tested; real DB/browser replay checks. Database-role test checks direct session reads/inserts cannot bypass application authentication. |
| F2: mixed amount edit/approval can approve above the new requested amount | Validate sanctioned amount against the effective requested amount from the same request. Notification content uses the effective title, amount, client and deal. | Mixed valid/over-limit handler cases and persisted-money database checks. |
| F3: valid JSON with wrong shape throws unexpectedly | Shared runtime validation for bodies, required text, dates, money, statuses and nested attachments. Malformed shapes return 400 before writes. | Null, array, primitive and malformed nested values across helpers and real handlers. |
| F4: attachment deletion and ticket update partially succeed | Ticket changes and attachment-row deletion share a transaction; post-commit storage cleanup remains best effort. | Mocked denial/failure checks plus a real Postgres trigger that fails deletion and proves both the edit and removal roll back. |
| F5: inherited properties pass status membership | Explicit own-property membership in the generated status enum. | `toString`, `constructor`, `__proto__`, unknown strings and wrong types are rejected before persistence. |

## Additional behavior fixed and protected

- **Concurrent creation:** a Postgres transaction advisory lock serializes code allocation and
  ticket creation. The next code uses the highest numeric `RB-` suffix, ignoring malformed
  legacy values. Concurrent creation and highest-code selection are checked against real Postgres.
- **Concurrent editing/approval:** conditional updates include previously read status and
  `updatedAt`; a conflict returns 409. The version timestamp always advances, including writes
  within one millisecond or after a clock correction. A coordinated edit/approval race uses real
  transactions and verifies that one writer succeeds and the stale writer cannot commit.
- **Attachment association:** new keys are scoped to the authenticated employee. Creation/addition
  checks image/PDF metadata, exact size limit and actual object length with HEAD. A foreign or
  missing upload cannot simply be attached by supplying client metadata. Existing linked receipt
  keys remain supported. This checks ownership and completed bytes, not file-content scanning.
- **Money and dates:** reject amounts beyond Decimal(12,2), nonfinite/wrong-type/negative values,
  and fractional cents, including tiny numbers that would silently round to zero. Valid decimal
  values such as 0.29 remain accepted. Dates require real `YYYY-MM-DD` calendar dates; omitted
  versus explicitly cleared edit dates are distinct. Totals sum integer cents and preserve the
  existing partial-approval shortfall accounting.
- **OAuth failures:** invalid provider payloads, unsuccessful exchanges, network/JSON/database
  failures and session-creation failures produce the documented friendly login error. State
  cookie validation/removal, secure attributes, verified email and eligibility are tested.
- **Uploads:** bitmap resources close even when canvas drawing cannot proceed. Malformed signing
  successes cannot start a PUT. Transient errors use fresh signatures and exact backoffs;
  explicit aborts stop immediately. This does not add an AbortController to the form's Remove
  button: removing an in-flight item still ignores its eventual completion.
- **UI accuracy:** finance copy now promises only the notifications the API implements. Successful
  form navigation has explicit timing tests, and the pending navigation timer is cancelled on
  unmount. Finance review and attachment controls support keyboard activation; modal focus is
  contained and returned to the trigger after closing.
- **Side-effect completion:** event writes and storage cleanup are awaited before responding,
  while preserving their existing nonfatal policy. Changed partial approval still awaits the
  email send, and transport errors resolve false. This is not a durable queue/outbox guarantee.

## Test organization and assertion quality

| Suite | Main contracts |
| --- | --- |
| `lib/auth.test.ts` | Opaque token lifecycle, cookie flags, eligible/active identities, allowlist, authorization redirects, failure behavior |
| `app/api/auth/auth.test.ts` | OAuth state/config/provider/eligibility/error matrix and logout using real handlers |
| `lib/validation.test.ts` | Runtime object/text/date/money/status/attachment rules and full/partial/cleared-reversal approval policy |
| `app/api/routes.test.ts` | GET/POST/PATCH/sign/download status, ownership and payloads; rejected requests have no writes, email, deletion or presigning; transactions/conflicts and awaited side effects |
| `lib/totals.test.ts` | Independently specified status totals, partial shortfall, cents, employee isolation and input immutability |
| `lib/email.test.ts`, `lib/email-transport.test.ts` | Exact table fields and amounts, escaping, optional client/deal/link/reply-to fields; transport request and true/false results |
| `lib/r2.test.ts` | Real SDK command shapes with mocked transport/presigner; upload omits signed ContentType, downloads pin MIME/disposition, expiry and environment contracts |
| `app/_components/upload.test.ts` | MIME, compression boundaries/fallback/cleanup, exact request/progress/timeout/backoff, transient/permanent failures, aborts and malformed signing payloads |
| `app/_components/TicketForm.test.tsx` | Required fields, full create/edit contracts, error recovery, navigation, duplicate submissions, attachments and out-of-order completion |
| `app/_components/Interactions.test.tsx` | Confirmation, cancellation, history/status display, attachment opening, identity/menu/navigation and keyboard focus |
| Admin review/table tests | Actions for all six statuses, partial bounds/prefill, request locks/errors/reset; combined filters, empty states and selected ticket details |

The server project uses Node; UI tests use jsdom. The existing email-template DOM inspection
opts into jsdom explicitly. Route tests invoke real handlers with real Request/Response objects
and promised route params; they mock external infrastructure rather than the decision logic.
Mutable mocks, env values, globals and timers are reset. The XHR fake now fails unexpected extra
sends. Test fixtures assert exact intended outcomes instead of calculating expectations with
copies of the production logic. There are no blanket component snapshots.

### Targeted regression experiments

Run `npm run test:mutations`. It copies only source/config/test files to a fresh temporary
directory, shares installed dependencies, verifies a passing baseline, changes one behavior at
a time, and restores/removes its own copy. It never edits working source or copies `.env`.
A startup failure is not counted as detecting a regression: the report must contain failed tests.

| Deliberate regression | Original audit | Strengthened suite |
| --- | --- | --- |
| Remove 1s/3s upload backoff | Survived | Detected |
| Report 100% for intermediate upload progress | Survived | Detected |
| Create tickets using PUT instead of POST | Survived | Detected |
| Remove required form attributes | Survived | Detected |
| Remove successful create navigation | Survived | Detected |
| Return false after successful email delivery | Survived | Detected |
| Change Client email-table heading | Survived | Detected |
| Change upload timeout to 1ms | Detected control | Detected |

This is evidence for these eight concrete contracts, not a claimed whole-repository mutation score.

## Integration and browser isolation

`npm run test:integration` and `npm run test:e2e` both use
[scripts/test-isolated.mjs](scripts/test-isolated.mjs). They create a fresh local Postgres cluster
and database under the OS temporary directory, generate local credentials, override database and
provider environment settings, and remove their own resources afterward. They do not read `.env`
or accept a caller-selected database. The fixture contains portal-owned tables and the minimum
identity fields required by Prisma; it is not a copy of the shared production database.

The real session rollout SQL is applied twice to verify repeatability. Integration tests use
actual Prisma queries, Decimal/date round trips, relations, transactions and session rows. Browser
tests exercise actual pages and HTTP APIs with real cookies and a local byte store. The storage
fixture accepts real presigned SDK requests, browser PUTs, HEAD verification and preview GETs,
but deliberately does not implement AWS signature validation. Provider OAuth exchanges and email
transport remain mocked/skipped; no external account is used.

The browser journeys cover forged-cookie/admin denial; employee creation with PDF upload,
editing and cancellation; finance partial approval, clearance and reversal; cross-employee page,
edit and attachment-download denial; and logout-token replay. Finance review includes keyboard
activation, reverse Tab containment, Escape and return of focus to the review trigger.

The harness explicitly propagates child failure after cleanup. This was tested because the
embedded database package's process-exit hook otherwise masked a nonzero `process.exitCode`.

## Tooling and maintenance updates

- Added the V8 coverage provider, Testing Library user-event, Playwright, disposable Postgres
  harness, real ESLint configuration and test scripts. Replaced obsolete `next lint` with ESLint.
- Updated Vitest and its provider together to 4.1.11. The lockfile resolves Next 16.3.4 and
  compatible PostCSS/nanoid/undici/image dependencies after npm reported advisories. The final
  clean install reports no known vulnerabilities; that is a dated advisory result, not a
  guarantee against unknown issues.
- Kept Vite at the existing 8.1.3 version explicitly. Updating the paired Vitest dependencies
  exposed an npm 10 optional-peer resolver crash; a temporary npm 11 process generated the
  lockfile. A subsequent clean `npm ci` succeeds using npm 10.9.4, so npm 11 is not a runtime or
  CI prerequisite.
- ESLint remains 9.39.5 because the installed React/import plugins declare ESLint 9 peer ranges.
  npm warns that ESLint 9 is no longer supported. A coordinated ESLint 10/plugin upgrade remains
  a follow-up; incompatible peer requirements were not bypassed. The current lint command passes
  with zero lint warnings. Three local effect-rule exceptions explain portal hydration/modal
  reset behavior; the rule remains enforced elsewhere.
- Next 16.3 generated the new root-parameter type import in `next-env.d.ts` and the
  `AGENTS.md`/`CLAUDE.md` local guide files during browser runs; these generated files are included.
- Updated README commands, auth/session behavior, attachment namespace, validation, concurrency,
  CI, coverage gates and deployment instructions. Old hardcoded test counts were removed.
- CI adds unit coverage/lint/typecheck/build, isolated integration and Chromium jobs with artifact
  retention. The local mutation command is available separately to avoid forcing every mutation
  experiment into the fast unit job.

## Deployment and compatibility

The session SQL and database verification in step 1 are complete for the configured shared
database as of 10 September 2026. Apply the SQL separately to any additional environment before
deploying this version there.

1. Review and apply the additive session SQL through the shared database's approved SQL process.
   Never use Prisma push/migrate on the introspected shared schema. The trusted server database
   connection must be the table owner or use a BYPASSRLS role; browser anon/authenticated roles
   must have no session policies. Existing non-server grants cannot bypass the enabled RLS.
2. Generate Prisma through `npm ci` or `npx prisma generate`, then deploy this version. Coordinate
   the rollout so old instances that trust email cookies are no longer serving requests.
3. Existing users must sign in again. Previously linked attachments work; uploads started before
   the new employee key namespace need to be selected/uploaded again. Invalid request shapes or
   overprecision amounts that previously reached Prisma now receive 400.
4. New sessions expire after 30 days and logout revokes them immediately. Schedule removal of
   expired rows if retention grows; no production scheduler or shared-DB cleanup was installed.

Current business rules were preserved where the audit requested a decision: owners edit only
pending/review tickets; admins cannot edit another owner's fields; admin non-cancel transitions
remain broader than the UI; admin self-approval is still permitted. Zero requested amounts and
nonempty legacy categories remain accepted. Full approval is stored as null; an omitted amount
when reverting cleared to approved preserves an existing partial. Notifications remain limited
to changed partial approvals. Duplicate local files still use the existing name-plus-size rule.

## Remaining limits and follow-ups

- Async server pages/layouts are 0% in unit coverage and stay visible. Browser journeys cover their
  important behavior, but do not exhaust every page state or constitute production-mode E2E tests.
- Loading/presentation components and unused `AdminActions`/`SignOutButton` stay visible at zero
  unit coverage. Removing unused flows needs a separate usage/product decision; low-value tests
  were not added simply to improve their percentage.
- Browser validation currently covers Chromium/desktop. Firefox, Safari, mobile file pickers,
  HEIC decoding on devices, expired preview refresh and actual Cloudflare CORS/signatures still
  need appropriate environment/device checks. The local PDF is a transport fixture, not proof
  of full PDF rendering quality. Real Resend delivery and Google account configuration are not
  established by mocked contracts.
- Unit branch coverage still leaves some menu/cancel/focus fallbacks and optional R2 configuration
  paths uncovered. Full source measurements below make those gaps explicit.
- Database tests validate the owned fixture schema, not Supabase pooler configuration, real
  deployment permissions, latency or all shared-table schema drift. Session role compatibility
  must be checked when applying the rollout SQL.
- Events, email and object deletion are best effort. Missing events, failed delivery, abandoned
  uploads and failed cleanup can still need operational reconciliation; no durable outbox or
  orphan sweeper was added. Transactional code allocation requires all writers to use the
  portal's locking convention.
- Stronger API transition restrictions, content scanning, upload quotas, pagination and exhaustive
  mutation testing remain separate product/operational work rather than hidden assumptions in
  tests. Adding the new server session table is the only database schema addition.

## Complete unit coverage inventory

Percentages below are from the final local V8 report. A 100% branch value in a trivial unexecuted
file can mean there were no measurable branches; read it alongside line/function coverage.

| Source | Lines | Branches | Functions |
| --- | ---: | ---: | ---: |
| `app/layout.tsx` | 0% | 100% | 0% |
| `app/page.tsx` | 0% | 0% | 0% |
| `app/_components/AttachmentLink.tsx` | 100% | 100% | 100% |
| `app/_components/Brand.tsx` | 0% | 0% | 0% |
| `app/_components/CancelTicketButton.tsx` | 95.83% | 75% | 80% |
| `app/_components/ConfirmDialog.tsx` | 100% | 96.29% | 100% |
| `app/_components/HistoryFilter.tsx` | 100% | 93.33% | 100% |
| `app/_components/Icons.tsx` | 85.71% | 100% | 85.71% |
| `app/_components/NavLinks.tsx` | 93.33% | 90.9% | 100% |
| `app/_components/SignOutButton.tsx` | 0% | 0% | 0% |
| `app/_components/Skeletons.tsx` | 0% | 0% | 0% |
| `app/_components/TicketCard.tsx` | 100% | 89.28% | 85.71% |
| `app/_components/TicketForm.tsx` | 97.22% | 94.06% | 100% |
| `app/_components/UserMenu.tsx` | 100% | 72.72% | 100% |
| `app/_components/upload.ts` | 100% | 96.82% | 100% |
| `app/_components/useDialogFocus.ts` | 100% | 79.16% | 100% |
| `app/admin/layout.tsx` | 0% | 100% | 0% |
| `app/admin/loading.tsx` | 0% | 100% | 0% |
| `app/admin/page.tsx` | 0% | 0% | 0% |
| `app/admin/_components/AdminActions.tsx` | 0% | 0% | 0% |
| `app/admin/_components/AdminEntriesTable.tsx` | 100% | 92.98% | 100% |
| `app/admin/_components/AdminReviewDialog.tsx` | 97.46% | 92.92% | 100% |
| `app/api/attachments/[id]/url/route.ts` | 100% | 90% | 100% |
| `app/api/auth/google/route.ts` | 100% | 100% | 100% |
| `app/api/auth/google/callback/route.ts` | 100% | 100% | 100% |
| `app/api/auth/logout/route.ts` | 100% | 100% | 100% |
| `app/api/r2/sign/route.ts` | 100% | 92.85% | 100% |
| `app/api/tickets/route.ts` | 100% | 100% | 100% |
| `app/api/tickets/[id]/route.ts` | 100% | 95.58% | 100% |
| `app/dashboard/layout.tsx` | 0% | 100% | 0% |
| `app/dashboard/loading.tsx` | 0% | 100% | 0% |
| `app/dashboard/page.tsx` | 0% | 0% | 0% |
| `app/dashboard/new/page.tsx` | 0% | 100% | 0% |
| `app/dashboard/tickets/[id]/loading.tsx` | 0% | 100% | 0% |
| `app/dashboard/tickets/[id]/page.tsx` | 0% | 0% | 0% |
| `app/dashboard/tickets/[id]/edit/loading.tsx` | 0% | 100% | 0% |
| `app/dashboard/tickets/[id]/edit/page.tsx` | 0% | 0% | 0% |
| `lib/attachment-access.ts` | 100% | 100% | 100% |
| `lib/auth.ts` | 100% | 96.87% | 100% |
| `lib/email.ts` | 100% | 96.15% | 100% |
| `lib/prisma.ts` | 0% | 0% | 0% |
| `lib/r2.ts` | 100% | 85.71% | 100% |
| `lib/tickets.ts` | 100% | 100% | 100% |
| `lib/totals.ts` | 100% | 100% | 100% |
| `lib/validation.ts` | 100% | 100% | 100% |
