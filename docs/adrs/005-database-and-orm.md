# ADR-005: Database Choice and ORM Selection

**Date:** 2024-01-01
**Status:** Accepted
**Deciders:** Core team

## Context

AudioBlock Backend needs a relational store for:

- User accounts, artist profiles, listener profiles
- Song metadata, upload state, IPFS CIDs
- Marketplace listings and purchase history
- Royalty records and reconciliation state

Requirements:

- Strong relational integrity (foreign keys, transactions)
- TypeScript-first data modelling
- Support for complex queries (search, aggregation for royalty splits)
- Compatible with existing Node.js ecosystem; deployable on Render/Railway

## Decision

Use **PostgreSQL** as the database and **TypeORM** as the ORM. Entities are defined as TypeScript classes with decorators (`@Entity`, `@Column`, `@ManyToOne`, etc.), and migrations are generated via `typeorm migration:generate` then applied with `typeorm migration:run`.

Connection management uses TypeORM's built-in connection pool (`pg` driver under the hood). Pool metrics are exposed via `DbPoolMonitor` and scraped by Prometheus.

## Consequences

### Positive

- PostgreSQL's JSONB columns handle semi-structured metadata (e.g. song tags, filter preferences) without schema changes
- TypeORM's migration tooling gives a full audit trail of schema changes
- The `AppDataSource` singleton is injected into services, making it straightforward to test with a separate test database
- Connection pool monitoring (`startDbPoolMonitor`) gives early warning on pool exhaustion

### Negative / trade-offs

- TypeORM's query builder can become verbose for complex joins; raw SQL fallback is sometimes needed
- TypeORM v0.3 has known rough edges around relation loading (eager vs lazy) that require care
- Schema migrations must be applied in order; out-of-order deploys can break the schema

### Neutral

- `AppDataSource` is initialised once in `src/index.ts` before routes are registered; services import it directly, which is a pragmatic choice that works for a single-process server

## Alternatives considered

| Option       | Why rejected                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Prisma       | Better DX for simple CRUD; less flexible for complex queries and doesn't support all TypeORM decorator patterns already in use |
| MongoDB      | Lack of relational integrity makes royalty-split ledger entries harder to keep consistent                                      |
| Drizzle ORM  | Newer project; less battle-tested at decision time; migration tooling less mature than TypeORM                                 |
| Raw SQL (pg) | No schema migration management out of the box; more boilerplate for entity mapping                                             |
