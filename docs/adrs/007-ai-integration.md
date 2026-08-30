# ADR-007: AI Integration

**Date:** 2026-08-28
**Status:** Accepted
**Deciders:** Core team

## Context

AudioBlock is a music NFT platform. As the product roadmap adds AI-assisted
features (e.g. content description, automated moderation triage, metadata
generation, or analytics-like derived insights), the backend will necessarily
call one or more external AI/ML providers. This must not be done ad hoc.

Several forces constrain the decision:

- Artists own their content; sending song audio, lyrics, or metadata to an
  external model without explicit consent is a trust and legal risk.
- Vendor lock-in: wiring a specific provider's SDK directly into business
  logic makes it hard to change models or providers later, and couples the
  product to a vendor's pricing/availability.
- Cost: AI inference is metered and can be expensive. Unbounded per-request
  calls are a budget risk.
- Data governance: we must be able to state precisely what is and is not sent
  to third parties, and retain or delete data per policy.

This ADR is a **doctrine** document: no AI feature ships yet (see
[`docs/AI_FEATURES.md`](../AI_FEATURES.md) for the current inventory), so this
decision establishes the rules any future AI integration must follow rather
than recording an implementation already built.

## Decision

Adopt a **provider abstraction layer** for all third-party AI calls, with
**user opt-in/opt-out**, **explicit data-retention rules**, and **cost
controls** as hard requirements. Concretely:

1. **Provider abstraction.** All third-party AI calls go through a thin
   internal service (e.g. `src/services/ai/AiProvider.ts`) exposing a small
   domain interface (`describeSong`, `summarize`, `classifyContent`, …) with
   the concrete vendor (OpenAI, Anthropic, a self-hosted model, …) hidden
   behind it. Business logic depends only on the interface, not on vendor
   SDKs/types. Providers are configured via environment variables
   (`AI_PROVIDER`, `AI_API_KEY`, etc.), never hard-coded, and a "null/no-op"
   provider is always available so the platform runs fully without any AI
   dependency.

2. **Opt-in / opt-out.** No content (audio, lyrics, metadata, or prompts
   derived from them) is sent to any AI provider unless the owning artist is
   **opted in** via a dedicated `User.aiFeatureOptIn` flag (default `false`),
   separate from the existing profile-privacy toggle. The flag is set only by
   the artist, is revocable at any time, and is enforced server-side in the
   provider service — not merely hidden in the UI. An opted-out artist's
   content is never submitted and no derived output is generated for it.

3. **Data retention.** Each AI feature records, in its own table, a minimal
   event: the provider used, what was sent (kind/scope descriptor, not the raw
   content), the date, and the retention window. We retain no raw content
   transmitted to a provider beyond what is required for the legal/audit
   record. Any provider-side retention is capped via provider settings (e.g.
   "do not retain"). Deletion follows the user's opt-out or account deletion.

4. **Cost controls.** Every AI call is rate-limited and subject to a per-feature
   and per-artist budget. Calls are audited (provider, timestamp, contract, and
   cost class). A feature fails closed (disabled) once its budget is exhausted
   rather than silently escalating spend.

5. **What is / is not sent to third-party providers.** We commit to the
   following explicit statement, which holds until an ADR supersedes it:
   - **NOT sent:** raw song audio, uploaded files, lyrics, or any un-redacted
     user/customer records are **never** sent to an AI provider today or in any
     planned feature.
   - **Sent (only with opt-in):** only the specific, minimal data a feature
     needs (e.g. a title or a seed prompt) is sent, and only for opted-in
     artists. It is always described in the feature's row of
     `docs/AI_FEATURES.md`.
   - **Non-AI third parties** (Pinata/IPFS, AWS S3, Stellar/Soroban, Dynamic
     Labs) remain storage/chain integrations and are out of scope of this ADR.

## Consequences

### Positive
- Vendor changes are low-cost: swapping a provider means implementing the small
  domain interface, not rewriting business logic.
- Artists retain control over their content, which is both a legal safeguard
  and a product trust signal.
- Cost blow-ups are contained by the budget/rate-limit guardrails.
- The commit to "no raw audio ever sent" gives customers a simple, defensible
  privacy promise.

### Negative / trade-offs
- The abstraction layer and audit tables add up-front engineering that does not
  ship a user-visible feature by itself; the value only materializes once
  AI features exist.
- A default-off flag means zero AI value until enough artists opt in, reducing
  the usefulness of AI features that depend on network effects.
- Provider-parity is imperfect: the domain interface is the ceiling, so a
  provider's distinctive capability may not be exposed unless the interface
  is extended deliberately.

### Neutral
- Strategies for a particular feature (which model, which provider) are left to
  that feature; this ADR fixes only the *plumbing*, consent, retention, and
  budget rules.
- The opt-in flag is defined here as a required field, but its exact name/location
  is confirmed when the first AI feature is implemented.

## Alternatives considered

| Option | Why rejected |
|--------|-------------|
| Call provider SDKs directly in feature code | Couples business logic to a vendor, blocks switching, mixes consent/cost/audit concerns into every call site |
| Always-on (no opt-in) | Unacceptable legal/trust risk: artists did not consent to their content being sent to third-party models |
| No abstract provider, only one fixed vendor | Vendor lock-in; hard to react to pricing/availability; contradicts provider-neutrality goal |
| Separate opt-in per AI feature | More granular but much higher complexity and surface for confusion; a single artist-level flag keeps the contract simple |
| Keep raw audio for offline re-processing | Violates the retention/minimization principle; we deliberately discard raw content after processing |
