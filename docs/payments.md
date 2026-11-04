# Bachs premium payments

The pricing page sends students to `/billing`, preserving their chosen plan through login or registration. Bachs hosted checkout takes one payment for the chosen period. No automatic recurring debit is configured.

## Deployment

1. Apply `prisma/migrations/20261103000000_add_payments/migration.sql` through the existing Prisma migration workflow (`npx prisma migrate deploy` on an already baselined database). Back up production before applying database changes. Generate the client with `npx prisma generate`. Deploy backend and student app together after the migration.
2. Configure the backend environment:

   ```dotenv
   BACHS_ENVIRONMENT=sandbox
   BACHS_API_KEY=sk_sandbox_REPLACE_IN_SECRET_STORE
   BACHS_WEBHOOK_SECRET=REPLACE_WITH_ENDPOINT_SIGNING_SECRET
   STUDENT_APP_URL=https://your-student-app.example
   PRO_MAX_EXPIRES_AT=2027-03-31T23:00:00.000Z
   ```

   `STUDENT_APP_URL` is the publicly reachable HTTPS origin of quiztaker-bjot. Bachs rejects localhost/private return URLs; use a public HTTPS development tunnel for sandbox checkout. Keep Bachs keys exclusively in the backend. The student app continues to use its server-only `BACKEND_URL` ending in `/api`.
3. In the Bachs Developer Portal, create a webhook destination at `https://YOUR_BACKEND/api/payments/webhook`, select `collection.succeeded`, and save its signing secret as `BACHS_WEBHOOK_SECRET`. Use the final URL without redirects. Enable NGN collection/balance for the Bachs merchant account and grant the API key checkout/payment permissions.
4. Exercise the flow in an isolated sandbox database with a Bachs sandbox payment, confirm both callback and webhook deliveries, and confirm the dashboard changes. For production, change `BACHS_ENVIRONMENT=live`, use a matching `sk_live_` key, and configure the live webhook signing secret. Do not use sandbox payments against the production student database.

No database migration, Bachs account configuration, or deployment is performed by these code changes.

## Access and pricing

Server-owned prices match `quiztaker-bjot/src/lib/pricing.ts`; the browser submits only a plan ID. The database/catalog use integer kobo; the adapter sends Bachs major-unit strings (e.g. `"10000.00"` NGN).

- Foundation: 1 calendar month; Advanced: 2; Ultimate: 3. Month-end dates clamp to the destination month's last day.
- Lite grants premium classes and study support. Pro and Pro Max also grant JAMB past-question access.
- Pro Max expires at the end of **31 March 2027, Africa/Lagos** by default. `PRO_MAX_EXPIRES_AT` is an exclusive timestamp; update it for future cycles. Pro Max cannot be purchased once that cutoff passes.
- Same-level purchases extend existing paid expiry. Higher-level monthly purchases begin immediately for their full duration, preserving any later existing expiry. Pro Max retains its fixed cutoff; upgrades from access lasting beyond that date require staff assistance. Lower-level purchases are blocked while a higher level is active. Pro Max cannot be repurchased while active.
- Existing premium accounts retain their existing class access. They do not gain Pro past-question access unless they have an explicit Pro entitlement. Existing paid students can be migrated deliberately with an audited plan ID, level and expiry; no historical plan is guessed.
- Expired paid subscriptions behave as regular on each authenticated request. Login and dashboard report the effective access, regardless of stale client state or JWTs.
- JAMB Practice's existing maintenance block is preserved. Pro authorization runs before maintenance on the API; removing the named maintenance middleware later must retain both authentication and `requirePro`.

## Confirmation and recovery

Signed Bachs webhooks and authenticated callback verification both retrieve the persisted checkout from Bachs, then check its checkout ID, reference, buyer, amount, currency, completed state, payment status and collected charge before granting access. Bachs signatures are checked over the original bytes with a five-minute timestamp tolerance, including rotation signatures.

A transaction locks the student row, re-reads the payment, and records access plus fulfillment atomically. Duplicate callbacks/events cannot extend access twice. Recent initialization retries reuse the persisted checkout and Bachs idempotency key. Browser redirects alone never grant access.

If Bachs is unavailable, users can retry verification; webhooks return a retryable error. Expired or cancelled checkouts are marked failed and may be replaced. Historical paid receipts remain stored even after access expires. Payments for Pro Max confirmed after its cutoff also require staff reconciliation; expired access is never presented as a successful activation. If an old lower-tier checkout is paid after a newer higher tier, access is not downgraded: the API reports a conflict for staff reconciliation/refund in Bachs. Mismatched payment data also requires staff investigation. Refund and dispute handling is manual; this integration does not automatically revoke a refunded entitlement.

## References

- [Bachs checkout guide](https://docs.bachs.io/guides/checkout/checkout-sessions)
- [Checkout verification fields](https://docs.bachs.io/api-reference/checkout-sessions/get-checkout-session)
- [Webhook signatures and retries](https://docs.bachs.io/guides/webhooks/overview)
