# Incident Response Plan & Postmortem Template

How we respond to production incidents affecting the AudioBlocks backend,
and the template for writing postmortems afterward.

## Severity levels

| Level | Definition | Examples | Response |
| ----- | ---------- | -------- | -------- |
| **SEV1** | Full outage or data loss; all users affected | API down, DB corruption, funds-impacting on-chain relay failure | All-hands; page on-call immediately; comms every 30 min |
| **SEV2** | Major feature degraded for many users | Uploads failing, streaming down, auth broken for a subset | On-call + 1 responder; status update hourly |
| **SEV3** | Limited impact | Single endpoint errors, worker queue backlog, elevated latency | On-call handles in business hours; daily update |
| **SEV4** | Minor / no user impact | Log noise, non-critical alert, cosmetic bug | Ticket; fix in normal cadence |

When in doubt, classify **up** a level. Downgrade only with evidence.

## Roles

- **Incident Commander (IC)** — owns the incident, makes calls, approves
  comms and rollbacks. One person only.
- **Operations Lead** — executes mitigation: restarts, rollbacks, scaling,
  failover. Reports findings to the IC.
- **Comms Lead** — drafts and sends user/status updates; keeps the incident
  timeline. May be the IC on SEV3/4.
- **Scribe** — captures timestamps, actions, and hypotheses in the incident
  channel for the postmortem. Rotates on long incidents.

For SEV3/4 a single on-call engineer can hold all roles.

## Communication

- **Internal:** dedicated incident channel (e.g. `#incident-<date>`); all
  responders join. IC posts a short status every 30 min (SEV1/2) or hourly
  (SEV3).
- **Status page / users:** post on first confirmation of user impact, on
  each material change, and on resolution. Never speculate publicly — state
  impact, status, and next update time.
- **Escalation:** if no ack in 15 min, escalate to the next on-call and the
  engineering lead.

## Mitigation first, root cause second

1. Stop the bleeding (rollback, feature-flag off, scale up, failover).
2. Confirm mitigation worked (metrics, error rates, user reports).
3. Only then investigate root cause.

Relevant runbooks: [runbooks/disaster-recovery.md](runbooks/disaster-recovery.md),
[worker-shutdown.md](worker-shutdown.md), [db-pool-alerting.md](db-pool-alerting.md).

## Postmortem

Every SEV1/SEV2 (and any SEV3 with user impact) gets a blameless postmortem
within 5 business days. File it in `docs/postmortems/YYYY-MM-DD-<slug>.md`
(create the directory on first use) and link it from the incident channel.

### Template

```markdown
# Postmortem: <short title>

- **Date:** YYYY-MM-DD
- **Severity:** SEV?
- **Duration:** <start> → <resolved> (<total>, <user-impact window>)
- **IC:** <name>  **Authors:** <names>
- **Status:** Draft | Reviewed | Published

## Summary
<2–4 sentences: what happened, who was affected, how it was resolved.>

## Impact
- Users affected: <count / %>
- Duration of impact: <window>
- Data loss: <none | details>
- Revenue/on-chain impact: <none | details>

## Timeline (all times UTC)
| Time | Event |
| ---- | ----- |
| HH:MM | <detection / alert / first report> |
| HH:MM | <ack, roles assigned> |
| HH:MM | <mitigation applied> |
| HH:MM | <impact confirmed over> |
| HH:MM | <root cause identified> |
| HH:MM | <resolved> |

## Root cause
<The technical cause, with links to code/config/PRs. Blameless language:>
<describe systems and decisions, not people.>

## What went well
- <e.g. alert fired quickly, rollback was clean>

## What went poorly
- <e.g. detection lag, unclear ownership, missing runbook>

## Action items
| # | Action | Owner | Due | Tracking |
| - | ------ | ----- | --- | -------- |
| 1 | <concrete fix — code, alert, runbook, or process> | <name> | YYYY-MM-DD | <issue link> |

## Lessons learned
<One paragraph: what we will do differently.>
```

### Rules

- **Blameless:** describe what failed, not who failed. "The deploy script
  skipped migration X" not "Alice forgot to run migrations."
- **Action items are mandatory:** every postmortem ends with owned,
  dated, tracked follow-ups. A postmortem with no actions is a failure.
- **Review:** the team reviews the draft within a week; the IC ensures all
  action items are filed as issues before closing.
