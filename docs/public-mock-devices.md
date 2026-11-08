# Public mock device limits

For public mocks with `multipleAttempts: false`, either a completed email or a completed browser device blocks further attempts for the same quiz. Active attempts are bound to their starting browser, which must use the original email to resume. Permitted admin retakes still work, and each mock has its own limit. Assigned exams and topic practice keep their existing rules.

The backend issues an opaque, signed HttpOnly cookie when listing mocks. It uses the existing `JWT_SECRET`, with a separate HMAC purpose, and persists only the SHA-256 device hash in `PublicMockSession.deviceHash`. Starts/submissions require a valid cookie; direct API calls without it fail with 428. The student portal proxy forwards only this cookie and relays its `Set-Cookie` response. Both public submission routes enforce the same limits under shared quiz locks and transaction advisory locks for the email and device.

This identifies a browser profile, not immutable physical hardware. Different browsers, private sessions, cleared/expired cookies, or secret rotation can create a new identity. No IP-based blocking is used, so students sharing a network are not blocked together. Historical sessions have no device identity until resumed/submitted; they cannot be backfilled accurately.

## Rollout

1. Apply `20261108000000_public_mock_devices` with `npx prisma migrate deploy` in the deployment environment, then run `npx prisma generate`.
2. Deploy the student portal cookie proxy, then the backend. The proxy remains compatible with the previous backend; deploying it first ensures cookie forwarding is ready when the backend begins requiring device cookies.
3. Keep `JWT_SECRET` consistent across backend instances. Rotating it invalidates existing device cookies and establishes new identities when users reload.

Do not remove the additive database column when rolling back. No live database migration or live student attempts are performed by the local test suite.

## Verification

Run `node --test test/public-mock-device.test.js test/public-mock-settings.test.js test/public-mock-transaction.test.js test/public-exams-route.test.js test/mock-subjects.test.js test/admin-submissions.test.js` plus Prisma validation, and TypeScript/lint checks in the student portal. Coverage includes a new email on the same device, a new device with the same email, independent quizzes, unfinished-session ownership, missing/forged cookies, concurrent starts/submissions, historical sessions, admin-enabled retakes, and coordination with paper replacement.

## Public transaction timeout fix

The original public flow used a quiz-wide `FOR UPDATE` lock with Prisma 6's default five-second interactive transaction timeout. Every start/submission for the same quiz waited behind all others, which could expire the transaction before the following quiz read (`P2028`).

`public-mock-transaction.js` scopes the fix to the modern start/submit routes and legacy public submission route:

- A `FOR SHARE` quiz lock allows independent students to proceed together while still conflicting with admin paper replacement and settings updates.
- Transaction advisory locks serialize matching normalized emails or devices within that quiz. Both locks are acquired in ascending signed 64-bit key order to avoid deadlocks and released automatically on commit/rollback. No session-level advisory locks are used, so this works with transaction pooling.
- Transactions have an explicit 10-second connection acquisition budget and 20-second execution budget. These options do not change transaction defaults in unrelated routes.
- Starting a known quiz ID does not load every available paper. Question shuffling, response formatting, and review rendering run after commit, reducing the time locks are held.
- Transaction expiry, pool acquisition timeout, and write conflict errors (`P2028`, `P2024`, `P2034`) return 503 with a safe retry message. Retrying a start resumes the same session; retrying submission returns the original result.

This timeout fix adds no schema changes and needs only a backend deployment when the device migration is already applied. Concurrency regression tests use a lock-aware database stub; they do not benchmark or access the live database.

References: [Prisma 6.19.3 transaction implementation](https://github.com/prisma/prisma/blob/6.19.3/packages/client/src/runtime/getPrismaClient.ts), [PostgreSQL row locks](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS), [PostgreSQL transaction advisory locks](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS).
