# ADR-009: GraphQL Query Layer over Indexed On-Chain Data (Spike)

**Date:** 2026-08-31
**Status:** Proposed
**Deciders:** Backend team

## Context

REST pagination and filtering on `IndexedEvent` and related on-chain entities becomes unwieldy as more contract-specific fields are added. Clients currently must:

- Call multiple endpoints to gather related data (events, royalty payouts, activity feed)
- Handle cursor-based pagination manually
- Over-fetch or under-fetch because REST endpoints return fixed shapes

As the number of Soroban contracts grows (NFT, artist, catalog, royalty, marketplace), the need for a flexible query layer increases.

## Decision

**Spike a GraphQL schema over the indexed tables and produce an ADR addendum with a clear adopt/defer recommendation.**

This issue is a spike — no production code is required. The deliverable is:

1. A sample GraphQL schema covering the core indexed entities
2. A prototype resolver layer (can be a standalone script or test file)
3. A written tradeoff analysis

## Consequences

### Positive

- Clients can request exactly the fields they need in a single query
- Related data (events → royalty payouts → activity) can be resolved in one round-trip
- Schema acts as documentation for the on-chain data model
- Enables future real-time subscriptions (GraphQL subscriptions over WebSocket)

### Negative / trade-offs

- Adds a new dependency (`graphql`, `@graphql-yoga/node`, or similar)
- Requires maintaining a schema alongside the existing REST API
- Resolver layer adds complexity for simple CRUD operations
- Team must learn GraphQL schema design and resolver patterns

### Neutral

- Can coexist with REST endpoints during a transition period
- The existing `ActivityController` REST endpoints remain unchanged

## Alternatives considered

| Option                            | Why rejected                                                               |
| --------------------------------- | -------------------------------------------------------------------------- |
| Improve REST with OpenAPI codegen | Doesn't solve the over-fetching / multiple round-trip problem              |
| Use JSON:API spec                 | Adds spec complexity without the query flexibility of GraphQL              |
| gRPC/protobuf                     | Poor browser support, harder to debug, overkill for read-heavy queries     |
| Skip entirely, defer              | Viable — REST works today, but technical debt grows with each new contract |

## Recommendation (to be filled after spike)

TBD — will be updated after the spike implementation.
