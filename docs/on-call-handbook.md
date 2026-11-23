# On-Call Handbook

This handbook is the entry point for on-call engineers. It maps every alert
defined in [`monitoring/prometheus-alerts.yml`](../monitoring/prometheus-alerts.yml)
to the runbook that explains how to respond, and it contains the security
incident runbook for credential and supply-chain compromise.

## Alert-to-Runbook Map

| Alert | Severity signal | Runbook |
| --- | --- | --- |
| `IndexerLagMetricsMissing` | Indexer metrics absent; indexer may be down or misconfigured | [`indexer-resync-runbook.md`](indexer-resync-runbook.md) |
| `HighIndexerLag` / `CriticalIndexerLag` | On-chain events falling behind | [`indexer-resync-runbook.md`](indexer-resync-runbook.md), [`indexer-backfill-runbook.md`](indexer-backfill-runbook.md) |
| `HighAuthenticationFailureRate` | Spike in failed authentications | [`monitoring-alerts.md`](runbooks/monitoring-alerts.md) — check auth logs, Privy availability |
| `PrivyCircuitBreakerOpen` | Privy token verification failing; circuit breaker open | [`PRIVY_AUTH_SECURITY_CHECKLIST.md`](PRIVY_AUTH_SECURITY_CHECKLIST.md), [`PRIVY_AUTH.md`](PRIVY_AUTH.md) |
| `PrivyServingStaleKeys` | JWKS cache stale | [`PRIVY_AUTH.md`](PRIVY_AUTH.md) — restart affected instances to force refresh |
| `HighSessionRevocationRate` | Abnormal session revocation volume | [`SESSION_MANAGEMENT.md`](SESSION_MANAGEMENT.md), [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) |
| `HighHttp5xxRate` | >5% 5xx responses for 10m | [`runbooks/monitoring-alerts.md`](runbooks/monitoring-alerts.md) |
| `HighHttpP95Latency` | p95 latency > 2.5s for 10m | [`db-pool-alerting.md`](db-pool-alerting.md), [`runbooks/monitoring-alerts.md`](runbooks/monitoring-alerts.md) |
| `SongProcessingQueueBacklog` / `CriticalSongProcessingQueueBacklog` | RabbitMQ `song_processing` queue growing | [`worker-scaling.md`](worker-scaling.md), [`runbooks/monitoring-alerts.md`](runbooks/monitoring-alerts.md) |
| Database pool saturation / backup failure | DB connectivity or backup alerts | [`database-backup-restore.md`](runbooks/database-backup-restore.md), [`db-pool-alerting.md`](db-pool-alerting.md) |
| Full outage / data loss | Catastrophic failure | [`runbooks/disaster-recovery.md`](runbooks/disaster-recovery.md) |

Every alert above has a dedicated runbook section. If a new alert is added to
`monitoring/prometheus-alerts.yml`, add a row to this table in the same PR —
the alert is not considered "wired up" until it maps to a runbook.

## General On-Call Procedure

1. Acknowledge the alert in the monitoring tool and note the firing rule.
2. Follow the runbook linked in the table above.
3. Check `docs/runbooks/monitoring-alerts.md` for HTTP and queue alert
   response steps and Prometheus validation commands.
4. Escalate per the contacts section of the
   [security incident runbook](#security-incident-runbook-credential-and-supply-chain-compromise)
   when the incident involves credentials, secrets, or dependency compromise.
5. Record the incident in the postmortem template (see
   [`docs/runbooks/disaster-recovery.md`](runbooks/disaster-recovery.md)).

## Security Incident Runbook: Credential and Supply-Chain Compromise

Use this runbook when a secret (database password, JWT/Privy keys, AWS
credentials, RabbitMQ credentials, webhook secrets) is suspected leaked, or
when a compromised dependency is suspected in the supply chain.

### 1. Triage and containment (first 30 minutes)

- Identify the blast radius: which credentials, which environments
  (staging/production), and what an attacker could do with them.
- Revoke or rotate the suspected credential immediately — rotation first,
  investigation second. See the rotation checklist below.
- If a dependency is suspected, pin or remove it: check
  `package-lock.json` for unexpected transitive deps, review recent
  `npm audit` output, and diff the dependency tree against the last known
  good release.
- Preserve evidence: export relevant logs (auth audit log, webhook delivery
  log, request logs) before rotating, since rotation can invalidate the
  forensic trail.
- Notify the security contact (see Contacts).

### 2. Credential rotation checklist

Rotate in this order (highest exposure first). After each rotation, deploy
or restart affected services and verify health checks pass.

- [ ] Database credentials (`POSTGRES_*`) — create new user/role, update
      secrets store, restart API and workers, revoke old role.
- [ ] `JWT_SECRET` / token signing keys — invalidates all sessions; coordinate
      with users via forced re-login.
- [ ] Privy credentials (`PRIVY_*`) — rotate app secret and webhook signing
      secret; verify webhook signature checks still pass.
- [ ] AWS/S3 credentials — rotate IAM access keys, update ECS/EC2 task
      definitions and worker env.
- [ ] RabbitMQ credentials — update `RABBITMQ_*` env vars and restart
      publishers/consumers.
- [ ] Pinata/IPFS API keys — rotate in Pinata dashboard, update env vars.
- [ ] Twitter OAuth secrets (`TWITTER_*`) — rotate app keys in the Twitter
      developer portal.
- [ ] Webhook endpoint secrets — regenerate and update integrations.
- [ ] Any API keys stored in `api_keys` table — force re-issue for affected
      scopes; see `ApiKeyService`.

### 3. History-rewrite policy

- Secrets must never be committed. `.env*` files are git-ignored; if a secret
  was committed, treat it as compromised and rotate it — do **not** rely on
  deleting the commit.
- If a secret reached the remote history, prefer `git filter-repo` (or BFG)
  to purge it from all branches, then force-push and have every collaborator
  re-clone or reset. Coordinate with the team before rewriting shared
  history.
- After a history rewrite, rotate **all** credentials that were ever present
  in the purged commits, not just the latest one — assume every historical
  value is compromised.
- File a postmortem documenting how the secret entered history and add a
  preventive check (e.g. a pre-commit secret scanner) if one is missing.

### 4. Dependency / supply-chain response

- Run `npm audit --audit-level=high` and `npm ls` to map the affected package.
- Check the package's registry page and GitHub advisories for the version in
  use; determine whether a patched version exists.
- Upgrade to the patched version (pin an exact version, no floating ranges),
  run the full test suite, and deploy.
- If no patch exists, remove or replace the dependency, or isolate the
  affected code path behind a feature flag until a fix lands.
- Review `npm ci` reproducibility: ensure `package-lock.json` is committed
  and CI uses `npm ci` (not `npm install`) so lockfile tampering is caught.

### 5. Contacts

- Security lead: _assign before launch — update this section with the
  responsible owner and escalation path._
- On-call rotation: _link the paging/rotation schedule here._
- External reporting: see [`docs/SECURITY_POLICY.md`](SECURITY_POLICY.md)
  for the vulnerability disclosure process.

## API Versioning and Deprecation Policy

All public API routes are served under the `/api` prefix (see
`src/app.ts`). Versioning is path-based.

### Versioning scheme

- Breaking changes to a resource's request/response contract require a new
  version prefix: `/api/v1/...`, `/api/v2/...`, etc. The current unversioned
  `/api/*` routes are treated as `v1`.
- Non-breaking changes (new optional fields, new endpoints, bug fixes) ship
  in place without a version bump.
- Deprecated versions remain mounted and functional for the deprecation
  window below; they are never silently removed.

### Deprecation process

1. Announce the deprecation in the changelog (`CHANGELOG.md`) and in the API
   docs (`docs/openapi.yaml`) at least **90 days** before removal for
   partner-facing endpoints, and **30 days** for internal/admin endpoints.
2. Mark deprecated endpoints/fields in OpenAPI with
   `deprecated: true` and a `Deprecation`/`Sunset` response header pointing
   at the migration guide and removal date.
3. Emit a warning in response headers (`Deprecation: true`,
   `Sunset: <http-date>`) during the deprecation window.
4. After the window closes, remove the old version in a dedicated PR that
   only deletes the deprecated surface — no unrelated changes.
5. Breaking-change PRs must update `docs/openapi.yaml`, the changelog, and
   this policy's version table in the same PR.

### Version table

| Version | Prefix | Status | Notes |
| --- | --- | --- | --- |
| v1 | `/api` | Current | Unversioned prefix; equivalent to `/api/v1` once introduced |

### Related documents

- [`docs/openapi.yaml`](openapi.yaml) — machine-readable API contract
- [`RELEASING.md`](../RELEASING.md) — release process
- [`docs/SECURITY_POLICY.md`](SECURITY_POLICY.md) — security reporting
