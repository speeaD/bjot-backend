# Public mock device limits

For public mocks with `multipleAttempts: false`, either a completed email or a completed browser device blocks further attempts for the same quiz. Active attempts are bound to their starting browser, which must use the original email to resume. Permitted admin retakes still work, and each mock has its own limit. Assigned exams and topic practice keep their existing rules.

The backend issues an opaque, signed HttpOnly cookie when listing mocks. It uses the existing `JWT_SECRET`, with a separate HMAC purpose, and persists only the SHA-256 device hash in `PublicMockSession.deviceHash`. Starts/submissions require a valid cookie; direct API calls without it fail with 428. The student portal proxy forwards only this cookie and relays its `Set-Cookie` response. Both public submission routes enforce the same limit under the quiz row lock.

This identifies a browser profile, not immutable physical hardware. Different browsers, private sessions, cleared/expired cookies, or secret rotation can create a new identity. No IP-based blocking is used, so students sharing a network are not blocked together. Historical sessions have no device identity until resumed/submitted; they cannot be backfilled accurately.

## Rollout

1. Apply `20261108000000_public_mock_devices` with `npx prisma migrate deploy` in the deployment environment, then run `npx prisma generate`.
2. Deploy the student portal cookie proxy, then the backend. The proxy remains compatible with the previous backend; deploying it first ensures cookie forwarding is ready when the backend begins requiring device cookies.
3. Keep `JWT_SECRET` consistent across backend instances. Rotating it invalidates existing device cookies and establishes new identities when users reload.

Do not remove the additive database column when rolling back. No live database migration or live student attempts are performed by the local test suite.

## Verification

Run `node --test test/public-mock-device.test.js test/public-mock-settings.test.js test/public-exams-route.test.js test/mock-subjects.test.js test/admin-submissions.test.js` plus Prisma validation, and TypeScript/lint checks in the student portal. Coverage includes a new email on the same device, a new device with the same email, independent quizzes, unfinished-session ownership, missing/forged cookies, concurrent starts/submissions, historical sessions, and admin-enabled retakes.
