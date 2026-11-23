# Email Deliverability

How AudioBlocks sends transactional email (verification and password-reset links) reliably, and how it keeps bad addresses from damaging sender reputation. Covers issue PROD-03.

## What the code does

| Concern | Behaviour | Where |
| ------- | --------- | ----- |
| Sending | Every transactional email is queued as an `email.send` job, then delivered through the configured provider (`EMAIL_PROVIDER`: `resend` or `sendgrid`). | `src/services/EmailService.ts`, `src/workers/JobQueueWorker.ts` |
| Retries | 5xx and network errors are retried. 4xx errors are not. | `handleEmailJob` |
| Suppression | Before every send, the job checks the `email_suppressions` table. Suppressed addresses are skipped and never retried. | `src/services/EmailSuppressionService.ts` |
| Bounce and complaint intake | Provider webhooks record suppressions. | `POST /api/email-events/:secret` (`src/routes/emailEventRoutes.ts`) |

### Event handling

| Provider event | Suppressed as | Notes |
| -------------- | ------------- | ----- |
| Resend `email.bounced` with `bounce.type = Permanent` | `bounce` | Transient and undetermined bounces are ignored, because the provider retries them. |
| Resend `email.complained` | `complaint` | |
| SendGrid `bounce` | `bounce` | SendGrid's `bounce` event is a hard bounce. Soft bounces arrive as `deferred` and are ignored. |
| SendGrid `spamreport` | `complaint` | |
| SendGrid `dropped` | `provider_drop` | The provider has already refused to send to this address. |

Every other event type is acknowledged with `200` and does nothing.

Addresses are stored lower-cased. Re-reporting an address updates its row.

## DNS: SPF, DKIM and DMARC

Set these up on the **sending domain**, the domain in `EMAIL_FROM` (today `noreply@audioblocks.com`). Use the values your provider shows in its dashboard. The examples below show the shape of each record. They are not copy-paste values.

### 1. SPF

One TXT record per hostname. Two SPF records on the same host make both invalid.

```
Host:  @            (or the provider's sending subdomain, for example send)
Type:  TXT
Value: v=spf1 include:<provider-spf-include> ~all
```

Use the include the provider lists. Examples: `include:amazonses.com` for Resend, which sends through SES, and `include:sendgrid.net` for SendGrid.

### 2. DKIM

Add the record set the provider gives you. These are usually CNAME or TXT records on a selector host.

```
Host:  <selector>._domainkey.<domain>
Type:  CNAME or TXT   (copied from the provider dashboard)
```

Wait until the provider marks the domain **verified** before relying on it.

### 3. DMARC

Start in monitoring mode. Tighten only after the reports look clean.

```
Host:  _dmarc.<domain>
Type:  TXT
Value: v=DMARC1; p=none; rua=mailto:<dmarc-report-inbox>; adkim=s; aspf=s
```

Move through `p=quarantine` to `p=reject` over several weeks. Watch the aggregate reports at each step.

### Checklist before launch

- [ ] SPF record published, with one SPF TXT per hostname
- [ ] DKIM verified in the provider dashboard
- [ ] DMARC published with `p=none` and a report inbox
- [ ] `EMAIL_FROM` domain matches the DKIM and SPF domain
- [ ] Test message to Gmail and Outlook arrives in the inbox with `spf=pass`, `dkim=pass` and `dmarc=pass` in the headers
- [ ] Owner has recorded the DNS state in the team runbook (the values are not stored in this repository)

## Webhook setup

Configure the provider to POST events to:

```
https://<api-host>/api/email-events/<EMAIL_EVENTS_WEBHOOK_SECRET>
```

1. Generate the secret with `openssl rand -hex 32`, then set `EMAIL_EVENTS_WEBHOOK_SECRET` in the API environment.
2. **Resend:** Dashboard → Webhooks → add the URL. Subscribe to `email.bounced` and `email.complained`.
3. **SendGrid:** Settings → Mail Settings → Event Webhook. Enable **Bounced**, **Spam Reports** and **Dropped**. Use the URL above.
4. Send a test event from the provider dashboard. The endpoint returns `200` with `{ "processed": n }`.

If `EMAIL_EVENTS_WEBHOOK_SECRET` is unset, the endpoint returns `404` for every request.

### Security of the secret

Providers cannot send custom auth headers, so the shared secret travels in the URL path.

- The comparison is constant-time.
- The secret is **redacted** from the request logger and the error handler (`redactWebhookSecretPath` in `src/middlewares/requestLogger.ts`).
- Your **reverse proxy and load balancer access logs** also record the path. Configure them to redact `/api/email-events/`, or keep those logs private.
- Rotate the secret by setting a new value and updating the provider URL. Do both in the same deploy window, because events sent to the old URL will return `404`.

**Known limitation:** this is not a signature check. Resend uses Svix signatures and SendGrid uses ECDSA signatures. A follow-up can verify those instead, which removes the secret from the URL.

## Operations

### Find out whether an address is suppressed

```sql
SELECT email, reason, source, "createdAt"
FROM email_suppressions
WHERE email = lower('someone@example.com');
```

### Remove a suppression

Only remove a suppression after the address is confirmed valid, for example because the owner has corrected a typo or the user has contacted support. Removing it without that check can damage sender reputation.

```sql
DELETE FROM email_suppressions WHERE email = lower('someone@example.com');
```

### Logs to watch

- `Email skipped: recipient is suppressed`: an email was not sent because of a suppression. Expected for bounced addresses. A sudden rise means a bad import or a broken form.
- `Failed to record email suppression events`: the webhook could not write. The provider will retry, so check the database.
- `Email send failed with client error, not retrying`: provider rejected the request. Check `EMAIL_API_KEY` and the sender domain.

## Scope

- Covers **transactional** email only: verification and password reset. Marketing and bulk email are out of scope and would need a separate list and an unsubscribe flow.
- Suppression is per **address**. It does not block a whole domain.
- The suppression list only applies to email that goes through the `email.send` job. Nothing else in the codebase sends email directly.

## Related

- [Environment variables](environment-variables.md): `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_EVENTS_WEBHOOK_SECRET`
- [Third-party processors](THIRD_PARTY_PROCESSORS.md): the email provider row
- [Rate limiting](RATE_LIMITING.md): resend and verification limits
