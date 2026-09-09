# Unit test audit and improvement proposal

Audit date: **10 September 2026**  
Repository revision: **`71cb6eddbcda7b5c52b848017496159794db3464`** (`feat: client/deal name in ticket`)  
Status: **Review document; implementation and test changes have not been applied.**

## 1. Assessment

The existing suite is fast and passes, but it provides narrow protection for a reimbursement application. Its strongest area is the browser upload pipeline. Authentication, ticket authorization, approval amounts, status transitions, attachment access, and financial totals have no automated tests in this repository.

The main findings are:

1. **26 tests pass across 3 files**, and TypeScript checking passes.
2. **Line, statement, function, and branch coverage cannot currently be measured with the repository's test setup.** The coverage provider is missing, and there are no coverage scripts, source inclusion rules, thresholds, or CI reports.
3. Tests directly exercise **3 of 40 production TypeScript/TSX files** under `app/` and `lib/`. This is a **7.5% file reach indicator, not a code coverage percentage**. There are no tests for any of the **8 HTTP handlers across 7 route files**.
4. **Seven deliberately introduced regressions still passed all 26 tests** in a disposable copy. A control regression to the upload timeout was detected. Several existing assertions need to become more precise.
5. The audit identified concrete, untested application problems, including accepting a plain email cookie as session identity and validating an approval against an amount that the same request can change.
6. Tests were partly updated for the latest client/deal fields, but their API validation, edit behavior, search, and display paths remain untested. The README still reports 23 tests in two files. The `lint` script is also obsolete and fails.

**Recommended order:** establish coverage reporting and strengthen existing assertions; address session integrity with regression tests; cover ticket permissions and monetary rules; then expand form, upload, admin UI, and integration coverage.

## 2. Scope and evidence

The review covered all 40 production `.ts`/`.tsx` files under `app/` and `lib/`, all three test files, Vitest configuration and setup, TypeScript and Next configuration, package manifests, CI, README behavior descriptions, the application-owned Prisma models, and relevant commit history. Presentation-only components were reviewed for test priority. CSS and static assets are not part of the unit coverage denominator; unrelated shared-database models are outside the proposed test scope.

The working tree was clean at the start. Tests and diagnostic experiments used mocked external services. The audit did not connect to the shared database, Google OAuth, R2, or Resend, and did not run migrations, install dependencies, or change application/test/configuration files. Only this report was added to the repository.

### Checks performed

| Check | Result | Interpretation |
| --- | --- | --- |
| `npm test -- --reporter=verbose` | **26 passed; 3 files; 3.06 seconds** | The committed tests pass with the locally installed dependencies. |
| `npm run typecheck -- --incremental false` | **Pass** | Application and test TypeScript passes without relying on the incremental cache. |
| `npm test -- --sequence.shuffle --sequence.seed=20260910` | **26 passed; 2.86 seconds** | No ordering failure observed in this additional ordering; this does not prove complete isolation. |
| `npm test -- --coverage --coverage.reportsDirectory=/tmp/erp-test-audit-coverage` | **Fails before tests run** | `MISSING DEPENDENCY Cannot find dependency '@vitest/coverage-v8'`. |
| `npm run lint` | **Fails** | `next lint` is interpreted as an invalid project directory ending in `/lint`. |
| Package/lockfile comparison | **Root dependency declarations match** | No manifest/lockfile drift was found. |
| Disposable-copy baseline | **26 passed** | Established that the experimental copy could run the original suite. |
| Eight controlled source mutations | **Seven survive; one detected** | Specific assertion weaknesses demonstrated; not a comprehensive mutation score. |
| Nine isolated diagnostic probes | **Nine confirmed observations** | Exercised current auth/route behavior with mocks; these are audit experiments, not new repository tests or acceptance criteria. |

Local versions: Node **22.21.1**, npm **10.9.4**, Vitest **4.1.10**, TypeScript **5.9.3**, jsdom **29.1.1**, React Testing Library **16.3.2**, jest-dom **6.9.1**, React **19.2.6**, Next **16.2.6**, Prisma **5.22.0**. CI also selects Node 22.

`npm ci`, a production build, a live browser workflow, and real database/storage integration were not run. This report does not establish production build health, deployment behavior, or actual database transaction outcomes.

## 3. Coverage assessment

### Existing suite inventory

| Test file | Tests | Behavior actually checked |
| --- | ---: | --- |
| [upload.test.ts](app/_components/upload.test.ts) | 15 | Four MIME cases; six transport/signing/retry cases; five compression cases. |
| [TicketForm.test.tsx](app/_components/TicketForm.test.tsx) | 8 | Upload on selection, progress UI, manual retry, creation metadata, failed-upload blocker, oversize rejection, duplicate selection, removing a failed item, and the edit-mode upload key hint. Some cases check several of these together. |
| [email.test.ts](lib/email.test.ts) | 3 | Client/deal rows in HTML and text, their omission for null legacy values, and selected HTML escaping cases. |
| **Total** | **26** | No skipped, focused, or todo tests were found. No snapshot tests were found. |

### Production surface reached by tests

| Area | Production files | Files directly exercised | Gap |
| --- | ---: | ---: | --- |
| Shared/admin components and browser upload helper | 16 | 2 | Only `TicketForm.tsx` and `upload.ts`; approval UI, cancellation, filters, dialogs, and session UI are absent. |
| Server libraries | 4 | 1 | Only `email.ts`; no `auth.ts`, `r2.ts`, or Prisma wrapper tests. |
| API routes | 7 | 0 | No handler tests for creation, editing, authorization, OAuth, signing, or download access. |
| Pages, layouts, loading components | 13 | 0 | No page-level protection, financial summary, or framework/browser workflow tests. |
| **Total** | **40** | **3** | **37 production modules are outside the existing tests' application import paths.** |

`TicketForm.test.tsx` replaces `uploadToR2` with a mock, so it does not test the real form-to-upload boundary. `upload.test.ts` exercises the actual upload helper separately. `email.test.ts` exercises the real email template and transport helper but replaces `fetch`.

### Why there are no reliable percentage figures yet

[vitest.config.ts](vitest.config.ts), lines 10–15, defines test discovery and jsdom but no coverage configuration. [package.json](package.json), lines 5–35, has no coverage command or provider dependency. CI runs plain `npm test`.

The absent provider prevented collection. No line/branch percentage has been estimated from file counts or physical source lines.

There is a second issue to address when enabling coverage: Vitest defaults to reporting files imported by tests. Explicitly include `app/**/*.{ts,tsx}` and `lib/**/*.ts` so untouched routes and libraries remain visible. Otherwise the report could look reassuring while omitting most application behavior. This is documented in the [Vitest coverage guide](https://vitest.dev/guide/coverage.html#including-and-excluding-files-from-coverage-report) and also described in the installed Vitest 4 type definitions.

## 4. Accuracy of the existing tests

### What is worth preserving

- Upload tests exercise the actual public helper and inspect returned attachment metadata, PUT method, content type, timeout, compressed bytes, and retry counts.
- Retry tests use fake timers rather than waiting several real seconds.
- Form tests assert visible progress/errors and that failed uploads prevent submission. They use labels and roles for many queries.
- Email tests cover backward compatibility for null client/deal fields and escaping of potentially unsafe HTML characters.
- External services are mocked, so the suite runs quickly without credentials or a database.
- The CI typecheck is useful because Vitest's transform/run path alone does not establish TypeScript correctness.

### Controlled regression experiments

Each mutation below was applied independently in `/tmp/erp-unit-test-audit-awzwbu_v`, followed by the full original suite. The source file was restored before the next experiment. The original repository source was never mutated.

| Mutation | Result | What needs to change in the tests |
| --- | --- | --- |
| Upload backoff `[1000, 3000]` → `[0, 0]` | **26/26 pass** | Assert attempts have not started before the 1-second and 3-second boundaries. `runAllTimersAsync()` plus call counts proves retries, not spacing. |
| Upload progress calculation → always report `100` | **26/26 pass** | Assert an intermediate percentage and progress reset on retry. The upload test only requires that `100` was reported at least once. |
| Form creation request `method: "POST"` → `"PUT"` | **26/26 pass** | Assert method and headers in addition to URL/body. The generic success mock accepts the wrong method. |
| Remove form `required` attributes | **26/26 pass** | Test missing required inputs and submit through a user interaction. Existing helpers always populate required text inputs and call `fireEvent.submit(form)` directly. |
| Remove successful create navigation to `/dashboard` | **26/26 pass** | Keep stable router spies, advance the 500 ms timer, and assert destination and refresh. |
| `sendEmail` returns `false` after a successful response | **26/26 pass** | Assert the public helper's boolean result, not just the generated JSON. |
| HTML client row heading `Client` → `Customer` | **26/26 pass** | Assert the actual table row/cells. A substring search is insufficient to verify the heading or its order. |
| **Control:** upload timeout `120_000` → `1` | **25 pass; 1 fails** | Existing explicit timeout assertion correctly detects this regression. |

These were selected to investigate concrete gaps. Seven survivors out of this selected set must not be reported as a repository-wide mutation score.

### Specific assertion and fixture improvements

| Evidence | Accuracy issue | Proposed update |
| --- | --- | --- |
| `TicketForm.test.tsx:10–12` | `useRouter` creates fresh, inaccessible spies on each call. Navigation behavior is effectively invisible. | Use `vi.hoisted` stable `push`/`refresh` spies; assert create, edit, cancel, success, and failure destinations. |
| `TicketForm.test.tsx:48–51` | Direct form submission bypasses native interactive submission behavior. | Use `userEvent.setup()` and click the submit button for normal flows. Retain direct events only for deliberate handler-level cases such as testing the uploading guard. |
| `TicketForm.test.tsx:54–59` | Every fetch succeeds regardless of URL, verb, or payload. | Match expected URL/method and reject unexpected requests; return realistic `Response` objects for success and failure cases. |
| `TicketForm.test.tsx:120–128` | Creation assertion omits method, headers, category, description, and expense date. | Assert the complete relevant request contract with an independently specified expected object. |
| `TicketForm.test.tsx:61–64` | `clearAllMocks()` clears call history but retains the upload mock implementation. | Explicitly `mockReset()` the shared upload mock before configuring each test. The shuffled run passed; this is a maintenance risk, not demonstrated flakiness. |
| `TicketForm.tsx:205–213` and form tests | Successful submits schedule real timers; tests finish before checking navigation. DOM cleanup does not itself cancel those timers. | Use controlled timers in navigation tests and clear pending timers in teardown. Cover unmount behavior when changing timer handling. |
| `upload.test.ts:166–188` | Same signing URL/key returned for every attempt; call counts do not prove that the next PUT uses the new signature. | Return distinct URL/key pairs for each attempt and check the PUT destinations and final attachment key. |
| `upload.test.ts:191–208` | Names say “does not retry a 4xx”, but only 403/401 are exercised. | Rename to the specific permanent errors and add 408/429 cases: implementation intentionally retries those statuses. |
| `upload.test.ts:137–163` | Sign body is checked, but signing URL/method/headers and the full progress sequence are not. | Assert `/api/r2/sign`, POST, JSON header, progress at 0/intermediate/100, and handling of non-computable progress. |
| `upload.test.ts:222–262` | The canvas fake always produces the supplied blob, even if the caller requests the wrong output MIME/quality or omits drawing. | Spy on `drawImage`, `toBlob`, and bitmap cleanup; assert JPEG, quality 0.82, dimensions, and resource release where contractually relevant. |
| `upload.test.ts:300–320` | Decode-failure case makes `URL.createObjectURL` throw. It does not exercise a failed or successful `Image.decode()` fallback. | Add separate fallback-success and fallback-rejection cases with object URL revocation assertions. |
| `email.test.ts:48–50` | `html.indexOf("Client")` can match the title “Client dinner” rather than the table heading; a missing substring also returns `-1`. | Parse HTML, locate exact label cells, and compare their row positions to the Requested row. |
| `email.test.ts:16–18` | Helper comment says “most recent” send but reads call zero; it also assumes a send occurred. | Assert exactly one fetch for single-send tests, or explicitly choose the last call for multi-send cases. |
| `email.test.ts:21–31` | Optional `APP_BASE_URL` and `RESEND_REPLY_TO` are not explicitly controlled. | Set/unset every environment variable used by the helper in relevant cases and restore them afterward. |

Testing Library documents that `user-event` simulates interactions and associated checks, while `fireEvent` dispatches individual events. This is a reason to improve normal form flows, not to mechanically replace every event in the suite. See the [Testing Library interaction guide](https://testing-library.com/docs/user-event/intro/).

## 5. Application issues the missing tests currently allow

Priorities below reflect potential impact: **P0** immediate security work; **P1** next implementation batch for authorization, monetary correctness, or consistency; **P2** subsequent correctness/maintenance work. The probes used mocks and establish handler behavior, not production incident history.

### F1 — P0: session identity has no authenticity check

**Evidence:** [lib/auth.ts](lib/auth.ts), lines 25–32 and 40–61.

The session setter writes the email directly to `rp_session`. The reader trusts that value to look up `VerifiedNumber` and derive admin access from `ADMIN_EMAILS`. There is no signature, server-issued opaque session lookup, or server-side expiry validation in this path. The `httpOnly` attribute does not establish that an incoming cookie was issued by the application.

**Confirmed in isolation:** a mocked incoming cookie containing a known active admin email, with a matching mocked identity row, resolves to `isAdmin: true`. React request caching was bypassed in the probe to exercise the identity resolver directly. No real account or deployment was accessed.

**Required regression direction:** a fabricated/tampered cookie must fail authentication; valid sessions must identify the correct employee; expired/revoked sessions must fail; logout must invalidate the chosen session mechanism. Choose the session mechanism before locking in tests. A test that merely expects a raw email cookie to authenticate would preserve this defect.

### F2 — P1: a combined amount edit and approval can approve more than the new request

**Evidence:** [ticket PATCH handler](app/api/tickets/%5Bid%5D/route.ts), lines 75–117, 153–180, 220–235, and 272–281.

An admin who owns the ticket can submit editing fields and an approval in one PATCH. Approval validation uses `existing.amount`; the write can simultaneously replace that amount with `body.amount`.

**Confirmed in isolation:** for a pending ticket with requested amount ₹5,000, `{ amount: 1000, status: "APPROVED", approvedAmount: 3000 }` reaches the update with requested ₹1,000 and approved ₹3,000. The email payload still says the request was ₹5,000.

**Required regression:** either reject combined edits/status changes or validate against the final effective amount and build notification content from the effective updated values. Also test changing the title in the same request; the notification currently reads `existing.title`.

### F3 — P1: valid JSON with the wrong shape can cause uncaught exceptions

**Evidence:** [ticket creation](app/api/tickets/route.ts), lines 47–63; [ticket PATCH](app/api/tickets/%5Bid%5D/route.ts), lines 44–85; [upload signing](app/api/r2/sign/route.ts), lines 18–34.

The `try/catch` blocks validate JSON parsing, then cast the result to a TypeScript type. They do not validate its runtime shape.

**Confirmed in isolation:** JSON `null` throws `TypeError` in all three handlers. A numeric signing filename also reaches `buildAttachmentKey` and throws before the signing `try/catch`. A whitespace-only ticket title reaches `prisma.ticket.create`.

**Required regression:** invalid JSON and invalid object shapes return a deliberate client error, with no writes or signing. Cover `null`, arrays, primitives, wrong field types, blank strings, invalid dates, and malformed attachments. Decide normalization/category rules explicitly instead of treating every currently accepted input as correct.

### F4 — P1: attachment deletion and ticket update can partially succeed

**Evidence:** [ticket PATCH handler](app/api/tickets/%5Bid%5D/route.ts), lines 197–240.

Attachment deletion is started alongside the ticket update in `Promise.all`. These operations do not share a transaction.

**Confirmed in isolation:** when the mocked ticket update rejects, the mocked attachment deletion can still run. The probe proves concurrent control flow; actual committed-state behavior needs a disposable database integration test.

**Required regression:** define the expected atomic outcome when editing a ticket and removing attachments. If all-or-nothing is required, the database test should verify that an update failure leaves attachment rows unchanged. Test best-effort R2 cleanup separately from database atomicity.

### F5 — P2: inherited object properties pass status validation

**Evidence:** [ticket PATCH handler](app/api/tickets/%5Bid%5D/route.ts), line 135.

`body.status in STATUS_LABEL` checks inherited properties too.

**Confirmed in isolation:** an admin PATCH with `status: "toString"` reaches `prisma.ticket.update` with that invalid status. The permissive Prisma mock does not reject it; this does **not** demonstrate a successful production update. The schema enum should reject it later, yielding a persistence error rather than the intended validation response.

**Required regression:** unknown and inherited property names return 400 before persistence. Use an explicit enum/schema or own-property membership check.

### Other behavior needing decisions or integration evidence

| Area | Observed gap | Test direction |
| --- | --- | --- |
| Concurrent ticket creation | `POST` reads the most recent short code and increments it; the README already acknowledges collisions. | Use concurrent creation against a disposable DB after choosing sequence/retry behavior. Mocked happy paths cannot prove uniqueness under concurrency. |
| Concurrent edit and approval | PATCH checks the previously read status, then updates by ID without a status/version condition. | Test an edit racing with approval; decide conflict handling before implementation. |
| Attachment metadata trust | Create/add operations accept client metadata directly. The signing route accepts a caller-supplied ticket hint. There is no upload ownership record/object verification in these paths. | Define ownership, size/type, and completed-upload rules; test forged or nonexistent keys and unauthorized attachment association. The DB has a unique `r2Key`, so simple duplication of an already linked key should not be described as a proven exploit. |
| Admin transition policy | The UI exposes a limited action set per status; the API permits broader admin transitions except cancellation restrictions. | Agree on the server transition matrix. Test UI and API expectations separately. |
| Notification promises | `AdminReviewDialog.tsx:136–140` says several status changes notify employees; the API sends only for a changed partial approved amount. | Decide whether copy or notification behavior should change. Do not add tests promising emails that do not exist. |
| Audit events and cleanup | Event/R2 failures are swallowed by design. Durability after a serverless response is not established by a mock resolving. | Cover nonfatal failures in unit tests; assess durable audit/cleanup requirements separately. |

## 6. Proposed test backlog

### A. Authentication and HTTP authorization — first priority

Use the real auth/handler logic with mocked cookies, Prisma, and service boundaries. For denied requests, assert both the response/redirect and **absence of writes, emails, deletes, or presigning**. Some existing handlers intentionally start a read alongside authentication, so do not blindly assert zero database reads for every 401.

| Target | Cases and expected contracts |
| --- | --- |
| `lib/auth.test.ts` | Missing/invalid/tampered/expired session; missing `VerifiedNumber`; missing `empID`; inactive employee; valid identity; admin allowlist trimming and casing; employee role column does not silently grant admin; `requireUser` and `requireAdmin` redirects; session clear/set behavior after F1 is addressed. |
| `app/api/auth/google/route.test.ts` | Missing client/redirect configuration; redirect query parameters; random state stored in cookie and URL; cookie attributes and lifetime. |
| `app/api/auth/google/callback/route.test.ts` | Provider error, missing code/state, missing/mismatched state cookie, state removal, missing configuration, token failure/no token, userinfo failure, unverified/missing email, unknown/inactive employee, successful upsert/session/redirect. Add network/JSON failures with agreed error behavior. |
| `app/api/auth/logout/route.test.ts` | Clears session and returns the expected JSON; define failure behavior. |
| `app/api/tickets/route.test.ts` GET | Anonymous → 401; employee query restricted to their `empID`; admin query includes all; response data shape and ordering where part of the contract. |
| `app/api/attachments/[id]/url/route.test.ts` | Anonymous → 401; missing row → 404; non-owner employee → 403; owner/admin allowed; no presign on denial; success passes stored MIME type and 300-second expiry; signer failure handled. |

For typical **valid-shaped** PATCH requests, preserve/test this existing authorization behavior unless product policy changes:

| Actor/action | Pending/review | Approved/cleared/rejected/cancelled |
| --- | --- | --- |
| Anonymous | 401 | 401 |
| Owner employee edits ticket fields | Allowed, subject to validation | 409 |
| Other employee edits ticket fields | 403 | 403 |
| Non-owner admin edits ticket fields | 403: current policy is owner-only editing | 403 |
| Owner employee cancels | Allowed | 409 |
| Other employee cancels | 403 | 403 |
| Admin cancels | Allowed | 409 under current code |
| Employee sets a non-cancel status | 403 | 403 |
| Admin sets a non-cancel status | Validate against the agreed transition policy | Validate against the agreed transition policy |

Also test missing tickets, ID versus short-code lookup, empty payloads, approved-amount-only payloads, mixed status/edit payloads, and changes that must not leak another employee's data. Decide whether empty/irrelevant PATCH requests should be rejected; they currently reach an update.

### B. Ticket validation, approval amounts, and side effects — first priority

| Target | Required scenarios |
| --- | --- |
| Ticket creation handler | Missing required fields; deal/client trimming; zero/negative/wrong-type amount; invalid date; omitted optional date; runtime object-shape validation; attachments/no attachments; server-derived submitter; initial short code and subsequent code; 201 response; event failure remains nonfatal. |
| Ticket PATCH validation | Omitted field remains unchanged; client/deal blank is rejected; trim provided names; date omitted vs null/empty vs valid/invalid; invalid amounts/statuses; attachment inputs; legacy nullable fields; F2/F3/F5 cases. |
| Full approval | Omitted or null approved amount stores null, except the documented cleared-to-approved preservation case; approved amount equal to requested stores null. |
| Partial approval | ₹5,000 requested and ₹3,000 approved stores ₹3,000 and produces the appropriate event/email. Reject zero, negative, nonnumeric, nonfinite, and over-request values. |
| Cleared reversal | `CLEARED → APPROVED` without an amount preserves an existing partial. Explicit null/equal-request amount produces full approval. |
| Notification conditions | Changed partial sends once; unchanged partial does not resend; full approval does not send the partial template; missing employee email skips; `false` send result does not fail an otherwise valid PATCH. |
| Awaited send | Hold the email promise unresolved and verify PATCH does not complete until it settles. This protects the documented serverless behavior. |
| Attachment removal | Lookup constrained to the current ticket; foreign attachment IDs never deleted; only matched keys sent to R2 cleanup; rejected R2 cleanup remains nonfatal; database consistency tested separately. |
| Audit trail | Correct ticket ID and event for submission/edit/status/partial approval; audit insert rejection does not change the successful response under current policy. |

Do not rely on `JSON.stringify(NaN)` or `JSON.stringify(Infinity)` to test nonfinite numbers: both serialize to `null`. Exercise pure validation helpers directly, or use a deliberate raw JSON numeric-overflow input where appropriate. Include Decimal/database precision tests rather than assuming every JavaScript number is representable in `Decimal(12,2)`.

### C. Financial totals and status display — high priority

Extract the calculation parts of [admin/page.tsx](app/admin/page.tsx), lines 59–102, and [dashboard/page.tsx](app/dashboard/page.tsx), lines 28–40, into small pure functions when implementing this batch. This makes their monetary rules directly testable without reproducing React Server Component behavior in jsdom.

Use independently specified fixtures and expected results:

| Fixture | Expected contribution |
| --- | --- |
| Pending ₹1,000 + review ₹500 | Pending count 2; pending amount ₹1,500. |
| Full approval ₹2,000, `approvedAmount = null` | Approved count 1; approved amount ₹2,000. |
| Partial approval ₹5,000 → ₹3,000 | Approved count 1; approved amount ₹3,000; rejected amount ₹2,000; rejected ticket count does not increase. |
| Cleared partial ₹4,000 → ₹2,500 | Cleared count 1; cleared amount ₹2,500; rejected amount ₹1,500. |
| Rejected ₹700 | Rejected count 1; rejected amount ₹700. |
| Cancelled ₹900 | No contribution to pending/approved/cleared/rejected monetary totals under current behavior. |

Add empty input, multiple employees, decimals, null legacy values, and input immutability cases. Decide cent rounding/precision policy; expected values should not be calculated by copying the implementation's reduction into the test.

### D. Complete the existing form and upload suites

| Target | Additions |
| --- | --- |
| `TicketForm.test.tsx` creation | Complete POST contract; field validation; category/date changes; deal/client trimming; API 400/401/409/500 responses; malformed error response; rejected fetch; retry after failure; busy state; duplicate-submit prevention; successful navigation. |
| `TicketForm.test.tsx` editing | Initial values and legacy blank client/deal names; actual PATCH URL/method/body; existing attachment removal IDs; adding/removing together; no re-upload of retained attachments; successful save/navigation; errors preserve edits. The current edit test checks only the upload hint. |
| Form attachment concurrency | Multiple files resolving out of order; duplicates in the same batch; same filename with different sizes; dropping files; pending upload submit guard; removing an in-flight item followed by its late completion; retry only the failed item; exact 25 MiB boundary and one byte over. |
| `upload.test.ts` MIME/compression | Remaining known extensions, mixed case, missing extension, large GIF bypass, exact 300 KiB boundary, portrait images, no upscaling, equal-size output, null canvas context/blob, successful `Image.decode` fallback, fallback rejection, resource cleanup. |
| `upload.test.ts` transport | 408/429 retries; permanent 400/401/403 failures; signing fetch rejection and 5xx; non-JSON error body; malformed success payload; fresh signature per attempt; exact backoff; 204 success; progress ordering and non-computable progress; explicit abort behavior. |

The current XHR fake cannot simulate `abort` or non-computable progress and defaults unspecified sends to success. Extend it with explicit scenarios and fail unexpected extra sends, while keeping count assertions. Browser-specific canvas decoding, real CORS, and mobile file-picker behavior still need browser/device checks.

Decide whether an abort should retry: the implementation currently treats the generic abort error as retryable. Also decide the duplicate-file identity rule; name plus size can suppress distinct files with equal-sized contents.

### E. Email and R2 server contracts

| Target | Additions |
| --- | --- |
| `lib/email.test.ts` transport | Assert endpoint, POST, authorization header, sender, recipient, subject, bodies, optional reply-to, and return value. Missing key/from and empty recipient skip fetch. Non-2xx, rejected fetch, and failure reading the error body resolve `false`. |
| Email template | Exact requested/approved/rejected amounts including decimal and Indian grouping cases; name/title/short-code escaping; apostrophes; client-only/deal-only/both/neither; undefined/null legacy values; APP_BASE_URL absent/present/trailing slash; exact subject and portal link. |
| `lib/r2.test.ts` | Mock AWS client/presigner; assert upload command intentionally omits `ContentType`; download command pins `ResponseContentType` and inline disposition; requested expiry forwarded; sanitized filename/key; missing environment; delete success/rejection. Reset module state between different client/env scenarios. |
| `app/api/r2/sign/route.test.ts` | Authentication, invalid JSON/object shape, required typed filename/MIME, draft/default and explicit hints, UUID/key construction, 300-second expiry, signer failure, and any adopted upload-ownership rules. |

The browser PUT test that checks a `content-type` header does **not** protect the server's intentional omission of signed `ContentType`. These are separate contracts in separate files; both matter for the documented mobile upload fix.

### F. Admin and employee components

| Target | Scenarios |
| --- | --- |
| `AdminReviewDialog.test.tsx` | Action buttons for all six statuses; full and partial request payloads; partial input bounds; existing partial prefill; pending request locks; success closes and refreshes; failure allows retry; Escape/backdrop while idle versus busy; reset on reopening/different ticket; nullable client/deal/date display. |
| `AdminEntriesTable.test.tsx` | Status/employee/search filters individually and combined; REVIEW counts as pending; search includes new client/deal fields and ignores case/outer whitespace; clear filters; empty data versus no matches; correct selected ticket passed to review dialog; partial/full amount display. |
| `HistoryFilter.test.tsx` | All six tabs, counts, REVIEW in active, empty states, and updated ticket props. |
| `TicketCard.test.tsx` | Edit/cancel only in pending/review; full versus partial approved/cleared amounts; correct links; cancellation confirmation and PATCH; failure recovery; success refresh and locking behavior. |
| `CancelTicketButton.test.tsx` | Keep/cancel choices; request body; optional redirect; refresh; API/network errors; busy state. |
| `ConfirmDialog.test.tsx` | Hidden/open states; confirm/close; Escape/backdrop; busy prevents dismissal/actions; listener cleanup. |
| `AttachmentLink.test.tsx` | Image/PDF output and accessible name; preview URL; click opens with `noopener,noreferrer`; decide expired-preview refresh behavior. |
| `UserMenu.test.tsx`, `NavLinks.test.tsx` | Open/close/outside click/Escape; identity/admin display; logout request and busy state; agreed logout-failure behavior; admin-only link visibility and active route. |

Include keyboard-focused browser checks for clickable table rows/attachment figures and modal focus management. These currently rely heavily on mouse interaction; a passing click-only component test would not establish keyboard accessibility.

`AdminActions.tsx` and `SignOutButton.tsx` have no in-repository consumers found by import/reference inspection. Decide whether to remove or retain them before spending substantial effort testing older duplicate flows. Likewise, `objectExists` and `publicUrl` in `lib/r2.ts` have no callers in this repository. Low-value tests should not be added solely to raise a percentage.

## 7. Test architecture and coverage updates

### Keep the current runner; improve its configuration

The installed Vitest/Testing Library stack runs successfully. This audit does not justify replacing it or upgrading every dependency. When implementing coverage, use **`@vitest/coverage-v8@4.1.10` to match the audited runner**, or deliberately upgrade the runner/provider together and validate the change. Adding a provider is required by the [Vitest coverage setup](https://vitest.dev/guide/coverage.html#coverage-providers).

Proposed coverage configuration to merge into the existing config:

```ts
coverage: {
  provider: "v8",
  include: ["app/**/*.{ts,tsx}", "lib/**/*.ts"],
  exclude: ["**/*.test.{ts,tsx}", "**/*.d.ts"],
  reporter: ["text", "html", "lcov", "json-summary"],
  reportsDirectory: "./coverage",
},
```

Add `"test:coverage": "vitest run --coverage"` to scripts and `coverage/` to `.gitignore` in that implementation batch. First produce a complete report; then introduce thresholds. These changes are proposals and have not been applied.

### Separate browser and server environments

Use Vitest test projects with explicit, disjoint file patterns:

| Project | Environment | Tests and setup |
| --- | --- | --- |
| Server | `node` | `lib/**/*.test.ts`, `app/api/**/*.test.ts`, and future pure domain helpers. Server setup handles env/mocks without importing DOM cleanup. |
| UI | `jsdom` | Shared/admin component tests, including the browser upload helper. Keep jest-dom and React Testing Library cleanup here. |

The current all-jsdom setting is suitable for the browser files but also runs `lib/email.test.ts` in a simulated browser. Future request/cookie/Prisma tests should run in the Node environment used by every route.

Keep real `Request`/`Response` and handler code in route tests. Mock Prisma and external boundaries, not the validation or approval code being evaluated. Pass route parameters as `Promise.resolve({ id })`, matching this repository's Next handler signatures. Model `redirect`/`notFound` as throwing control flow rather than a no-op that lets execution continue.

Use typed fixtures and mocks to reduce `as never`/untyped call indexing. Explicitly reset mutable mock behavior, restore spies and environment/global stubs, and control time only where behavior depends on it. Do not assume `clearAllMocks` resets implementations or that restoring globals clears timers.

### Coverage thresholds should follow risk

The following are **proposed future targets, not measured results**:

| Surface | Proposed gate |
| --- | --- |
| Authentication, ticket authorization/approval helpers, financial calculations | Every agreed decision-table scenario; aim for at least 95% lines/functions and 90% branches per critical file after its suite is added. |
| Active form/upload/admin interaction modules | Aim for at least 85% lines and 80% branches, with the business scenarios above explicitly tested. |
| Whole repository | Record the initial complete baseline and prevent unexplained regression; raise the floor as batches land. Do not hide untested routes/pages to meet an arbitrary target. |
| Presentation-only/loading code | Keep visible in the full inventory/report; no dedicated percentage gate or snapshot expansion solely for coverage. |

A coverage percentage is insufficient as an acceptance condition. For example, executing an approval branch without checking the sanctioned amount still permits a serious error. Supplement critical branches with targeted mutation checks after their tests exist.

### Use integration/browser tests where unit tests cannot establish correctness

Next's [Vitest guide](https://nextjs.org/docs/app/guides/testing/vitest) recommends E2E coverage for async Server Components. Test extracted monetary/query policy helpers as units, and validate actual routing, layouts, redirects, and rendered pages through the running application.

Proposed small integration/browser set:

1. Authorized employee creates a ticket with an attachment, sees it in history/detail, edits it while pending, and cancels it.
2. Another employee cannot read/edit that ticket or obtain its attachment URL; admin access follows policy.
3. Finance partially approves, clears, then reverts a ticket; employee/admin totals and displayed amounts remain consistent.
4. OAuth callback/session/logout contracts work through real HTTP using controlled provider responses and synthetic identities.
5. Prisma round trips preserve Decimal/date values and relations; ticket codes remain unique under concurrent creation; edit/removal failures have the agreed transactional outcome.
6. Browser upload works against an isolated storage fixture, including CORS and the supported mobile decoding/fallback path. Mocked XHR tests cannot prove bucket/browser interoperability.

Database integration must use a disposable database containing application-owned fixtures and the required identity relation. The README identifies the configured database as shared with other apps and forbids `prisma db push`/`prisma migrate` against it. Do not point automated tests at that shared instance or synchronize the entire introspected schema as part of test setup.

## 8. Freshness, documentation, and CI

| Finding | Evidence | Proposed update |
| --- | --- | --- |
| Latest feature only partly tested | Commit `71cb6ed` added four lines to the form tests and three email cases while also changing API validation, pages, admin search, and model fields. | Add create/edit/legacy/search/notification cases for client/deal names across those boundaries. |
| README test count stale | `README.md:244–245` says 23 tests in two files; actual count is 26 in three. | Update commands/suite descriptions; preferably avoid a hardcoded count that becomes stale with every test addition. |
| Retry wording inaccurate | README and upload comments broadly say 4xx fail immediately; `upload.ts:48` retries 408 and 429. | Document permanent versus transient statuses and rename the two overbroad existing test names. |
| Lint command obsolete | `package.json:9` uses `next lint`; the audit command fails. | Add a compatible ESLint flat configuration and direct ESLint script, then CI lint. Next 16 removed `next lint` and no longer lints during build, as documented in the [Next 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16#next-lint-command). |
| CI has no coverage reporting/gate | `.github/workflows/ci.yml:19–24`: install → typecheck → plain tests. | Run coverage in CI and upload HTML/LCOV/JSON summary artifacts; enforce staged gates after baseline collection. |
| No build/integration/browser job | Only the single test job is defined. | Add a separate build check and a small isolated integration/browser job as that suite is implemented. Typechecking plus unit tests does not validate App Router execution. |
| Generated routes can affect typecheck context | `next-env.d.ts` imports generated `.next/dev/types/routes.d.ts`; the local checkout contains `.next`. | Ensure clean CI deliberately generates route types or validates through the build; do not rely on a developer's existing `.next` tree. The local typecheck pass is not a demonstrated clean-install result. |
| No explicit test output exclusions | `.gitignore` has no coverage directory entry. | Ignore generated coverage/report outputs when enabling those tools; preserve useful reports as CI artifacts. |
| Obsolete comments/copy can mislead tests | PATCH comment says `updateMany`, but code calls `update`; nested attachment writes exist. Admin page says approvals are final while review UI permits reopening. | Reconcile comments/copy with agreed behavior before using them as expected test results. |

A package-version freshness or vulnerability scan was not performed. “Updates” here means aligning tests and tooling with this code and the installed stack; no claim is made that every dependency is the latest available version.

## 9. Suggested implementation batches

| Batch | Concrete deliverable | Completion condition |
| --- | --- | --- |
| 1. Measurement and existing assertions | Matching coverage provider, complete source inventory/report, CI artifact; exact request/router/email assertions; retry timing/signature tests; README correction. | Coverage runs locally/CI; all seven demonstrated surviving regressions are detected by relevant tests; original behavior still passes. |
| 2. Session/auth security | Agreed session integrity fix and auth/OAuth/download authorization suites. F1 should take precedence if this application is exposed to users. | Fabricated/tampered sessions rejected; valid/invalid identities and role matrix verified; denied actions cannot produce protected side effects. |
| 3. Ticket and money rules | Route validation and approval matrix; F2/F3/F5 fixes with failing-first regressions; extracted totals tests. | Combined amount/approval cannot violate the effective request; date/name/amount/status contracts pass; full/partial/cleared behavior and notification conditions verified. |
| 4. Attachments and active UI | Complete edit/upload tests; R2 contracts; admin review/filter/cancel/dialog tests. | Metadata, ownership, upload lifecycle, and UI error/busy states verified; user-visible state matches API policy. |
| 5. Integration and consistency | F4 atomicity decision/fix; disposable DB tests; browser journeys; build/lint CI. | Transactional outcome, concurrent updates/codes, Decimal/date behavior, and actual routing verified in their real runtimes. |

Avoid setting a target number of tests. A parameterized status/role matrix may provide more protection than many superficial render assertions. Keep each implementation batch reviewable and report its newly covered scenarios and remaining gaps.

### Decisions to discuss before behavior-changing implementation

- Session mechanism and invalidation/expiry requirements.
- Whether a single PATCH may both edit financial fields and change status.
- Which admin transitions the API should permit; whether self-approval is intended.
- Zero-amount reimbursements, maximum amount, and fractional precision/rounding rules.
- Whether title/category/description should be trimmed and categories enforced server-side.
- Whether ticket edits plus attachment removal must be atomic.
- Upload ownership/completion validation and treatment of removed in-flight uploads.
- Which status changes actually require notifications and durable audit events.
- Whether the unused legacy components/helpers should be retired.

These decisions are recorded for the requested discussion. They did not prevent the audit and do not require changing the current code as part of this report.

## 10. Full production-file review inventory

“Existing tests” refers only to committed tests at the audited revision, not temporary audit probes. Recommended browser checks supplement unit tests for async pages and framework behavior.

| File | Existing tests | Recommended emphasis |
| --- | --- | --- |
| `app/_components/upload.ts` | 15 | Strengthen transport/compression assertions and missing branches. |
| `app/_components/TicketForm.tsx` | 8 | Create/edit contracts, validation, timers, concurrent attachments. |
| `lib/email.ts` | 3 | Transport failures/return values and complete template semantics. |
| `lib/auth.ts` | None | Session integrity, identity/role rules, redirects. |
| `lib/r2.ts` | None | AWS command arguments, environment, signing/deletion. |
| `lib/prisma.ts` | None | Lower priority wrapper checks only if changed; actual persistence belongs in integration tests. |
| `app/api/tickets/route.ts` | None | GET visibility and POST validation/persistence contracts. |
| `app/api/tickets/[id]/route.ts` | None | Ownership/status/amount matrix, events/email, attachment consistency. |
| `app/api/r2/sign/route.ts` | None | Auth, input shape, signing options and errors. |
| `app/api/attachments/[id]/url/route.ts` | None | Owner/admin authorization and download options. |
| `app/api/auth/google/route.ts` | None | OAuth configuration, state and redirect. |
| `app/api/auth/google/callback/route.ts` | None | Callback branches, employee lookup, session establishment. |
| `app/api/auth/logout/route.ts` | None | Session invalidation and response. |
| `app/admin/_components/AdminReviewDialog.tsx` | None | Status actions, partial approval, async/keyboard behavior. |
| `app/admin/_components/AdminEntriesTable.tsx` | None | Filtering/counts/search/review mapping. |
| `app/admin/_components/AdminActions.tsx` | None | No consumer found; decide retention first. |
| `app/_components/TicketCard.tsx` | None | Partial amounts, action eligibility and cancellation. |
| `app/_components/HistoryFilter.tsx` | None | Status counts/filtering/empty states. |
| `app/_components/CancelTicketButton.tsx` | None | Confirm/request/error/redirect behavior. |
| `app/_components/ConfirmDialog.tsx` | None | Actions, dismissal rules and lifecycle. |
| `app/_components/AttachmentLink.tsx` | None | Preview/open behavior; browser keyboard checks. |
| `app/_components/UserMenu.tsx` | None | Menu lifecycle, roles and logout. |
| `app/_components/NavLinks.tsx` | None | Admin link eligibility and active navigation. |
| `app/_components/SignOutButton.tsx` | None | No consumer found; decide retention first. |
| `app/_components/Brand.tsx` | None | Presentation; low priority. |
| `app/_components/Icons.tsx` | None | Presentation; no dedicated suite needed for static SVG paths. |
| `app/_components/Skeletons.tsx` | None | Presentation; no snapshot expansion solely for coverage. |
| `app/admin/page.tsx` | None | Extract/test financial rollup; browser-check data/display. |
| `app/admin/layout.tsx` | None | Browser-check admin boundary plus auth helper tests. |
| `app/admin/loading.tsx` | None | Browser smoke/presentation, low priority. |
| `app/dashboard/page.tsx` | None | Extract/test employee totals and owner query policy. |
| `app/dashboard/layout.tsx` | None | Browser-check authenticated layout and navigation. |
| `app/dashboard/loading.tsx` | None | Browser smoke/presentation, low priority. |
| `app/dashboard/new/page.tsx` | None | Thin form wrapper; cover through form tests/browser journey. |
| `app/dashboard/tickets/[id]/page.tsx` | None | Owner/admin reads, missing ticket, status/partial/date/legacy display, attachments/timeline. |
| `app/dashboard/tickets/[id]/loading.tsx` | None | Browser smoke/presentation, low priority. |
| `app/dashboard/tickets/[id]/edit/page.tsx` | None | Owner-only edit, allowed statuses, initial data and legacy nullable fields. |
| `app/dashboard/tickets/[id]/edit/loading.tsx` | None | Browser smoke/presentation, low priority. |
| `app/page.tsx` | None | Signed-in redirects and OAuth error display via browser/framework tests. |
| `app/layout.tsx` | None | Root rendering/build/font integration; low unit-test priority. |

## 11. Reproducing the audit observations

The baseline commands are listed in section 2. Temporary experiments remain under `/tmp/erp-unit-test-audit-awzwbu_v` for this workspace session; `/tmp` is not durable repository storage.

- `check_mutants.py` contains each exact source replacement from section 4, runs the suite once per replacement, and restores the source in `finally`.
- `mutation-results.json` and individual JSON/log files record each run.
- `audit-auth.test.ts`, `audit-routes.test.ts`, and `probes.config.ts` contain the nine diagnostic observations from section 5.
- The probe command was `node node_modules/vitest/vitest.mjs run --config probes.config.ts --reporter=verbose` from that temporary directory.

The probe assertions deliberately describe current defects. Future repository regression tests should assert the agreed corrected behavior and first fail against the current implementation. Do not copy the diagnostic expectations into the main suite as desirable behavior.
