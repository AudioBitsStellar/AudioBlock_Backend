# ADR-007: AI Integration Architecture and Data-Handling Policy

**Date:** 2026-08-28
**Status:** Proposed
**Deciders:** Core team

## Context

AudioBlock is considering integrating AI-powered features such as recommendation engines, automated content tagging, and generative music tools. These capabilities require careful architectural planning to ensure:

- User data (audio content, listening habits, wallet data) is handled securely
- Artists retain control over how their content is used for AI training
- AI services are loosely coupled to avoid vendor lock-in
- The system remains compliant with privacy expectations

## Decision

Introduce AI capabilities through a dedicated **AI Service Layer** that acts as an adapter between the core backend and external or internal AI providers. The architecture follows these principles:

1. **Opt-in only**: Artists must explicitly opt in before their content is used for AI training or inference beyond core platform features.
2. **Data isolation**: AI training pipelines operate on a separate data store (or snapshot) that is populated only from opted-in content.
3. **Provider abstraction**: All AI providers (recommendation, tagging, generation) are accessed through a common interface defined in `src/services/ai/`, enabling swap-in replacement.
4. **No raw audio in prompts**: AI text-to-text features (e.g., lyric analysis) receive only the requested metadata, not raw audio streams.
5. **Audit trail**: All AI data access is logged with artist ID, data type, and timestamp for compliance review.

## Consequences

### Positive
- Artists retain full control; no silent data usage
- Provider abstraction avoids lock-in to any single AI vendor
- Audit trail supports future compliance needs (GDPR, etc.)
- Separate data store limits blast radius of AI-related breaches

### Negative / trade-offs
- Additional infrastructure required for isolated AI data store
- Opt-in flow adds friction for onboarding new artists to AI features
- Provider abstraction layer adds modest code complexity

### Neutral
- Existing recommendation or analytics features are not affected until explicitly migrated
- AI features are gated behind a feature flag (`AI_ENABLED`) for gradual rollout

## Alternatives considered

| Option | Why rejected |
|--------|-------------|
| Use artist content by default (opt-out) | Violates privacy expectations; legal risk |
| Inline AI calls within existing services | Increases coupling; harder to audit data access |
| Build all AI capabilities in-house | Beyond team scope; vendor solutions are mature for most use cases |
