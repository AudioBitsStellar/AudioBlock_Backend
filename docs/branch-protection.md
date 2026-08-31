# Branch Protection Rules

This document is the **source of truth** for AudioBlock Backend's branch protection
configuration. Live GitHub settings must match what is recorded here.

> **Admin responsibility:** After any change to the live settings (GitHub →
> Settings → Branches), update this file in the same PR so docs and reality stay
> in sync. See the [Reconciliation Checklist](#reconciliation-checklist) at the
> bottom of this file.

---

## Protected Branches

### `main`

`main` is the production-ready branch. All code here has been reviewed, tested,
and is safe to deploy.

| Rule                                       | Setting                      | Rationale                                                   |
| ------------------------------------------ | ---------------------------- | ----------------------------------------------------------- |
| Require a pull request before merging      | **Enabled**                  | No direct pushes to `main`                                  |
| Required approving reviews                 | **1** (minimum)              | At least one peer review on every change                    |
| Dismiss stale reviews on new commits       | **Enabled**                  | Re-review required if PR is updated after approval          |
| Require review from Code Owners            | **Enabled**                  | CODEOWNERS reviewers auto-requested for mapped paths        |
| Require status checks to pass              | **Enabled**                  | CI must be green before merge                               |
| Required status checks                     | `test` (Jest), `build` (tsc) | Ensure tests and TypeScript compile pass                    |
| Require branches to be up to date          | **Enabled**                  | PR branch must be rebased/merged with `main` before merging |
| Require conversation resolution            | **Enabled**                  | All review threads must be resolved                         |
| Restrict who can push to matching branches | **Enabled**                  | Only maintainers / repo admins may bypass                   |
| Allow force pushes                         | **Disabled**                 | Prevents history rewrite on `main`                          |
| Allow deletions                            | **Disabled**                 | `main` cannot be deleted                                    |
| Require signed commits                     | **Recommended**              | Enable once the team has GPG/SSH signing set up             |
| Lock branch                                | **Disabled**                 | `main` accepts PRs normally                                 |

---

## Recommended Additional Rules (not yet enforced)

These are best-practice rules to enable as the team grows:

| Rule                           | Why                                                               |
| ------------------------------ | ----------------------------------------------------------------- |
| Require signed commits         | Guarantees commit authorship; protects against spoofed commits    |
| Require linear history         | Keeps `git log` clean; enforces rebase-or-squash merge strategy   |
| Require deployments to succeed | Gate on a staging deploy passing before merge (once CD is set up) |

---

## Branch Naming Conventions

While not enforced by GitHub protection rules, all contributors must follow this
naming scheme (documented here for reference and potential future ruleset enforcement):

| Prefix      | Use case                              | Example                     |
| ----------- | ------------------------------------- | --------------------------- |
| `feat/`     | New feature                           | `feat/artist-royalty-split` |
| `fix/`      | Bug fix                               | `fix/upload-chunk-timeout`  |
| `chore/`    | Maintenance, tooling, deps            | `chore/update-stellar-sdk`  |
| `docs/`     | Documentation only                    | `docs/soroban-integration`  |
| `hotfix/`   | Urgent production patch               | `hotfix/v1.1.1`             |
| `refactor/` | Code restructure, no behaviour change | `refactor/song-service`     |
| `security/` | Security fix or hardening             | `security/jwt-expiry`       |

---

## Reconciliation Checklist

A maintainer with **admin access** must verify these settings match the table above
after this PR is merged. Steps:

1. Go to **GitHub → AudioBlock_Backend → Settings → Branches**.
2. Click **Edit** on the `main` rule.
3. Confirm each row in the [main rules table](#main) matches the live setting.
4. If any setting differs:
   - If the live setting is **stricter** than documented → update this file to
     match and note the rationale.
   - If the live setting is **looser** than documented → tighten the live setting
     to match this document.
5. Record the verification date and your GitHub handle in the table below.

### Verification Log

| Date        | Verified by                      | Notes                                      |
| ----------- | -------------------------------- | ------------------------------------------ |
| _(pending)_ | _(admin to fill in after merge)_ | Initial setup — rules created with this PR |

---

## Rationale for Key Decisions

**Why 1 required reviewer and not 2?**  
The team is currently small. One review is a meaningful gate without slowing down
delivery. Raise to 2 when the contributor count grows beyond ~5 active engineers.

**Why "require branches to be up to date"?**  
Prevents a scenario where two PRs individually pass CI but break each other when
merged sequentially. Forces the last PR author to resolve conflicts explicitly.

**Why disable force pushes?**  
Once a commit is on `main` it becomes the baseline for other branches, hotfixes,
and release tags. Rewriting that history would silently break everyone else's
local checkouts.
