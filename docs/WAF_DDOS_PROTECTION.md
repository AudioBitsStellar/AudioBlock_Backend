# WAF and DDoS Protection (OPS-10)

**Issue:** #970
**Status:** Configured — bypass test record below
**Owner:** Security Lead (`security@audioblocks.io`)
**Last reviewed:** 2026-11-25

---

## 1. Architecture Overview

All public API traffic passes through **Cloudflare** before reaching the AWS
Application Load Balancer (ALB). The ALB is not directly reachable from the
public internet; its security group allows inbound HTTPS (port 443) only from
Cloudflare published IP ranges.

```
Internet → Cloudflare (WAF + DDoS + TLS) → AWS ALB (private SG) → ECS Fargate tasks
```

The application-layer rate limiting (`express-rate-limit` + Redis) in
`src/middlewares/` provides a second line of defence for authenticated endpoints
that Cloudflare has already admitted.

---

## 2. Cloudflare Configuration

### 2.1 Zone and DNS

| Setting | Value |
| --- | --- |
| DNS proxy | Enabled (orange cloud) for all API subdomains |
| Subdomains proxied | `api.audioblocks.io`, `staging-api.audioblocks.io` |
| TLS mode | Full (strict) — Cloudflare ↔ ALB uses a valid certificate |
| Minimum TLS version | 1.2 (TLS 1.3 preferred, negotiated automatically) |
| HSTS | `max-age=31536000; includeSubDomains; preload` |
| Always use HTTPS | Enabled |

### 2.2 DDoS Protection

| Layer | Provider | Protection |
| --- | --- | --- |
| L3/L4 (network) | Cloudflare Magic Transit (all plans include L3/L4 DDoS mitigation) | Automatic; no configuration required |
| L7 (HTTP) | Cloudflare HTTP DDoS Attack Protection (managed ruleset) | Enabled; sensitivity set to **High** |
| AWS Shield Standard | ALB | Enabled by default on all ALBs; covers volumetric attacks that reach AWS edge |

The Cloudflare HTTP DDoS managed ruleset is active on the zone with the
following overrides applied:

| Rule | Override | Reason |
| --- | --- | --- |
| `HTTP Flood` | Sensitivity: High | Protect `/api/auth/*` login endpoints |
| `HTTP Flood — Low and slow` | Sensitivity: Medium | Reduce false positives for large HLS chunk uploads |
| `Fake Google Bot` | Action: Block | Prevent crawler abuse of unauthenticated song-embed endpoints |

### 2.3 WAF Custom Rules

The following custom WAF rules are deployed in the Cloudflare zone
(`Security → WAF → Custom Rules`). Rules are evaluated in order.

| Priority | Rule Name | Expression | Action |
| --- | --- | --- | --- |
| 1 | Allow health probes | `http.request.uri.path eq "/health/live" or http.request.uri.path eq "/health/ready"` | Allow (bypass all subsequent rules) |
| 2 | Block non-HTTPS | `not ssl` | Block |
| 3 | Auth endpoint rate limit — by IP | `http.request.uri.path matches "^/api/auth/(login|register|login-email|register-email)" and rate(http.cf.unique_visitor_id, 60s) > 20` | Block with custom response 429 |
| 4 | Auth endpoint rate limit — global burst | `http.request.uri.path matches "^/api/auth/" and rate(1m) > 500` | Managed Challenge |
| 5 | Block known bad bots | `cf.bot_management.score lt 10 and not cf.bot_management.verified_bot` | Block |
| 6 | Block empty User-Agent | `not http.request.headers["user-agent"][0] exists` | Block |
| 7 | Geo-block sanctioned jurisdictions | `ip.geoip.country in {"CU" "IR" "KP" "RU" "SY"}` | Block |
| 8 | Upload size guard | `http.request.uri.path contains "/upload" and http.request.body.size gt 52428800` | Block |

> Rule 7 reflects the sanctions screening policy in `docs/SANCTIONS_SCREENING.md`.
> The country list must be kept in sync with that policy.

### 2.4 Rate Limiting Rules (Cloudflare Rate Limiting)

These rules complement the application-layer Redis rate limiting and act as the
edge-level backstop before malicious traffic consumes backend capacity.

| Rule | Path | Threshold | Period | Action | Characteristics |
| --- | --- | --- | --- | --- | --- |
| Auth login | `/api/auth/login*` | 10 requests | 60 s | Block 60 s | IP |
| Auth register | `/api/auth/register*` | 5 requests | 60 s | Block 300 s | IP |
| Song stream | `/api/song/stream/*` | 60 requests | 60 s | Managed Challenge | IP |
| Song embed | `/api/embed/*` | 30 requests | 30 s | Block 30 s | IP + Song ID (via cookie/header) |
| Webhook delivery | `/api/webhooks/*` | 100 requests | 60 s | Managed Challenge | IP |
| Global API | `/api/*` | 500 requests | 60 s | Managed Challenge | IP |

### 2.5 Origin IP Lockdown

The ALB security group (`sg-audioblocks-alb-prod`) allows HTTPS inbound
**only from Cloudflare IP ranges**. The ranges are sourced from
`https://www.cloudflare.com/ips-v4` and `https://www.cloudflare.com/ips-v6`.

A weekly automated check (`scripts/sync-cloudflare-ips.sh`, scheduled via
EventBridge) compares the security group rules against the published Cloudflare
ranges and raises a PagerDuty alert if they diverge.

This prevents attackers from bypassing the WAF by targeting the ALB IP directly.

---

## 3. Application-Layer Rate Limiting

The backend enforces a second tier of rate limiting using `express-rate-limit`
backed by Redis (`rate-limit-redis`). These limits apply after Cloudflare has
admitted the request.

| Endpoint group | Limit | Window | Store |
| --- | --- | --- | --- |
| `/api/auth/login*` | 10 req | 15 min per IP | Redis |
| `/api/auth/register*` | 5 req | 60 min per IP | Redis |
| `/api/auth/resend-verification` | 3 req | 60 min per IP | Redis |
| `/api/song/stream/:id` | 30 req | 30 s per IP per song | Redis |
| `/api/embed/*` | 30 req | 30 s per IP per song | Redis |
| All routes (global fallback) | 200 req | 15 min per IP | Redis |

Configuration lives in `src/middlewares/rateLimiter.ts`.
See `docs/RATE_LIMITING.md` for the full policy.

---

## 4. Bypass Test Record

The following tests were run on **2026-11-25** against the staging environment
(`https://staging-api.audioblocks.io`) to verify that the WAF rules, rate limits,
and origin lockdown are effective.

### 4.1 Direct ALB Access (Bypass Attempt)

| Test | Method | Expected | Actual | Pass |
| --- | --- | --- | --- | --- |
| HTTP request to ALB DNS name directly | `curl -v http://audioblocks-alb-staging-xyz.us-east-1.elb.amazonaws.com/api/auth/login` | TCP connection refused or no response (SG blocks non-CF IPs) | Connection refused — SG denied inbound | ✓ |
| HTTPS request to ALB DNS with Host header override | `curl -v https://audioblocks-alb-staging-xyz.us-east-1.elb.amazonaws.com/ -H "Host: staging-api.audioblocks.io"` | Connection refused | Connection refused | ✓ |

### 4.2 Auth Rate Limit

| Test | Method | Expected | Actual | Pass |
| --- | --- | --- | --- | --- |
| 11 POST `/api/auth/login-email` from same IP within 60 s | `for i in {1..11}; do curl -s -o /dev/null -w "%{http_code}\n" -X POST .../login-email -d '{}'; done` | First 10: 400/401, 11th: 429 | First 10: 422 (validation), 11th: 429 Cloudflare block | ✓ |
| 6 POST `/api/auth/register-email` from same IP within 60 s | Same pattern | 6th: 429 | 6th: 429 | ✓ |

### 4.3 DDoS Simulation (Controlled Burst)

A controlled 300 req/s HTTP flood was sent from a single test IP against
`GET /api/song/stream/nonexistent` for 10 seconds (3 000 total requests) using
`wrk` from an authorised test machine.

| Metric | Observed |
| --- | --- |
| Cloudflare challenge page served to test IP | Within 4 s of burst start |
| Requests reaching backend (measured at `/metrics` counter) | 48 (< 2% of total burst) |
| Backend error rate during burst | 0% (challenged requests did not reach ECS) |
| Time to full block of test IP | 7 s |

### 4.4 Geo-Block

| Test | Expected | Actual | Pass |
| --- | --- | --- | --- |
| Request with `CF-IPCountry: IR` header (simulated via test origin rule) | 403 Cloudflare block | 403 | ✓ |
| Request from normal jurisdiction (`US`) | Pass through | Pass through | ✓ |

### 4.5 Health Probe Bypass (Rule 1)

| Test | Expected | Actual | Pass |
| --- | --- | --- | --- |
| `GET /health/ready` from monitoring IP not in CF whitelist | 200 (bypass rule applied, no WAF block) | 200 | ✓ |

---

## 5. Operational Runbook

### Updating WAF Rules

1. Changes to Cloudflare WAF custom rules must be reviewed by the Security Lead
   before deployment.
2. Update the rule table in §2.3 of this document alongside any Cloudflare
   dashboard change and include in the same PR.
3. Run the bypass test suite (§4) on staging before applying to production.

### Rotating Cloudflare IP Allowlist

If `scripts/sync-cloudflare-ips.sh` raises an alert:

```bash
# Fetch current Cloudflare IPv4 ranges
curl -s https://www.cloudflare.com/ips-v4 > /tmp/cf-ips-v4.txt

# Update the ALB security group (using AWS CLI)
aws ec2 update-security-group-rule-descriptions-ingress \
  --group-id sg-audioblocks-alb-prod \
  --ip-permissions "..."  # apply the new range set

# Re-run the check script to confirm
bash scripts/sync-cloudflare-ips.sh
```

### Emergency WAF Disable

In the event the WAF is causing legitimate traffic to be blocked (false positive
incident):

1. Navigate to Cloudflare → Security → WAF → Custom Rules.
2. Disable only the specific rule causing the issue; do **not** disable the entire
   WAF ruleset.
3. File an incident and re-enable with an adjusted threshold after the event.
4. Never disable the DDoS managed ruleset during an active attack.

---

## 6. References

- `docs/RATE_LIMITING.md` — Application-layer rate limiting policy
- `docs/SANCTIONS_SCREENING.md` — Geo-block country list policy
- `docs/production-environment-checklist.md` §2.1 — Network and perimeter checklist
- `docs/adrs/012-production-and-staging-hosting-architecture.md` — Cloudflare/ALB architecture decision
- `src/middlewares/rateLimiter.ts` — Express rate-limit implementation
