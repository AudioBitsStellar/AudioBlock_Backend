# Subgraph Versioning Strategy

**Status:** Proposed
**Issue:** #663
**Related:** [ADR-009: GraphQL Query Layer](./adrs/009-graphql-query-layer-spike.md), [Indexer Guide](./INDEXER_GUIDE.md)

## Context

The Graph subgraph integration requires a clear versioning and upgrade strategy to handle:

- Schema changes and breaking updates
- Progressive rollout without downtime
- Rollback capabilities when issues arise
- Compatibility between backend code and deployed subgraph versions

## Versioning Scheme

### Version Format

Subgraph versions follow semantic versioning: `MAJOR.MINOR.PATCH`

- **MAJOR**: Breaking schema changes (remove fields, change types, rename entities)
- **MINOR**: Additive changes (new fields, new entities, new queries)
- **PATCH**: Bug fixes, indexing improvements, no schema changes

**Examples:**

- `1.0.0` → `1.1.0`: Added new `PlayCount` entity
- `1.1.0` → `1.1.1`: Fixed indexer bug in royalty calculation
- `1.1.1` → `2.0.0`: Renamed `Artist.wallet` to `Artist.walletAddress` (breaking)

### Version Metadata

Each deployed subgraph includes version metadata in the schema:

```graphql
type _Meta_ {
  """
  Subgraph version in semantic versioning format
  """
  version: String!

  """
  Deployment block number (genesis for this deployment)
  """
  deploymentBlock: BigInt!

  """
  Network name (mainnet, testnet)
  """
  network: String!

  """
  Last indexed block
  """
  block: _Block_!
}
```

Backend queries check the version on startup and reject incompatible deployments.

## Deployment Strategy

### 1. Development and Testing

**Location:** Testnet only

1. Deploy candidate version to testnet subgraph
2. Run integration tests against testnet subgraph
3. Monitor for 24-48 hours
4. Verify query performance and correctness

**Naming Convention:**

- Testnet: `audioblock-testnet-v{MAJOR}-{MINOR}-{PATCH}`
- Example: `audioblock-testnet-v1-2-0`

### 2. Mainnet Staging (Blue-Green)

**Approach:** Deploy new version alongside current production version

```
Production (current): audioblock-mainnet-v1-1-0
Staging (new):        audioblock-mainnet-v1-2-0
```

**Process:**

1. Deploy new version to staging slot
2. Wait for full sync to current block
3. Run smoke tests against staging endpoint
4. Enable canary traffic (10% of queries → staging)
5. Monitor error rates, latency, consistency
6. If successful, promote staging to production
7. Deprecate old version after 48 hours

**Traffic Splitting:**

Backend supports multiple subgraph endpoints with weighted routing:

```bash
# .env configuration
GRAPH_SUBGRAPH_URL_PRIMARY=https://gateway.thegraph.com/api/{key}/subgraphs/id/audioblock-mainnet-v1-2-0
GRAPH_SUBGRAPH_URL_CANARY=https://gateway.thegraph.com/api/{key}/subgraphs/id/audioblock-mainnet-v1-1-0
GRAPH_SUBGRAPH_CANARY_PERCENTAGE=10  # 10% to canary, 90% to primary
```

### 3. Rollback

**Instant Rollback:**

Update environment variable to point back to previous stable version:

```bash
# Rollback from v1.2.0 to v1.1.0
GRAPH_SUBGRAPH_URL=https://gateway.thegraph.com/api/{key}/subgraphs/id/audioblock-mainnet-v1-1-0
```

**No downtime:** Backend restarts gracefully with new URL

**Rollback Triggers:**

- Query error rate > 5% for 5 minutes
- Subgraph indexing stops or lags > 1000 blocks
- Data consistency failures detected
- Performance degradation > 2x baseline latency

### 4. Deprecation

Old versions are deprecated but not deleted immediately:

1. **Active** (current production): Full query support
2. **Deprecated** (previous version): Available for 7 days post-promotion
3. **Archived** (older versions): Read-only, no guarantees
4. **Deleted**: After 30 days from deprecat

```typescript
// Query works on both v1.1.0 and v1.2.0
const query = `
  query GetArtist($id: ID!) {
    artist(id: $id) {
      id
      name
      # Conditionally include based on subgraph version
      ${subgraphVersion >= '1.2.0' ? 'socialLinks { platform url }' : ''}
    }
  }
`;
```

### Breaking Changes (Major Versions)

**Required:** Field removal, type changes, entity renames

```graphql
# v1.x.x (old)
type Artist {
  wallet: String!
}

# v2.0.0 (breaking)
type Artist {
  walletAddress: Bytes! # Renamed + type changed
}
```

**Migration Steps:**

1. Deploy v2.0.0 to testnet
2. Update backend code to support both v1.x and v2.x schemas
3. Deploy backend with version detection
4. Deploy v2.0.0 to mainnet staging
5. Run blue-green rollout
6. Deprecate v1.x after 7 days

**Version Detection:**

```typescript
const subgraphVersion = await queryMeta();
if (subgraphVersion.startsWith('1.')) {
  return queryArtistV1(id);
} else if (subgraphVersion.startsWith('2.')) {
  return queryArtistV2(id);
} else {
  throw new Error(`Unsupported subgraph version: ${subgraphVersion}`);
}
```

### Data Migrations

**Scenario:** Historical data needs reprocessing for new schema

**Example:** Adding `totalRevenue` field to existing artists

1. Deploy new subgraph version (schema includes `totalRevenue`)
2. Subgraph resyncs from genesis with new handlers
3. Old version continues serving queries during resync
4. Promote new version once caught up

**No manual data migration required** — The Graph handles reindexing automatically.

## Version Compatibility Matrix

Backend version declares min/max compatible subgraph versions:

```typescript
// src/config/subgraph.ts
export const SUBGRAPH_VERSION_COMPATIBILITY = {
  min: '1.0.0',
  max: '2.0.0',
  preferred: '1.3.0',
};
```

**Startup Validation:**

```typescript
const deployedVersion = await getSubgraphVersion();
if (!isVersionCompatible(deployedVersion, SUBGRAPH_VERSION_COMPATIBILITY)) {
  logger.error(
    { deployedVersion, required: SUBGRAPH_VERSION_COMPATIBILITY },
    'Incompatible subgraph version',
  );
  process.exit(1);
}
```

## Multi-Network Versioning

Different networks can run different subgraph versions:

```bash
# Testnet runs bleeding-edge
GRAPH_SUBGRAPH_URL_TESTNET=audioblock-testnet-v2-0-0-beta1

# Mainnet runs stable
GRAPH_SUBGRAPH_URL_MAINNET=audioblock-mainnet-v1-3-0
```

**Network Detection:**

```typescript
const network = process.env.SOROBAN_NETWORK;
const subgraphUrl =
  network === 'mainnet'
    ? process.env.GRAPH_SUBGRAPH_URL_MAINNET
    : process.env.GRAPH_SUBGRAPH_URL_TESTNET;
```

## Monitoring and Alerts

### Key Metrics

**Per-version metrics:**

- `subgraph_query_duration_seconds{version="1.3.0"}`
- `subgraph_query_errors_total{version="1.3.0", reason="timeout"}`
- `subgraph_indexing_lag_blocks{version="1.3.0"}`

**Version adoption:**

- `subgraph_active_versions{version="1.3.0", status="production"}`

### Alerts

```yaml
- alert: SubgraphVersionMismatch
  expr: subgraph_deployed_version != subgraph_required_version
  for: 5m
  annotations:
    summary: 'Backend requires subgraph v{{ $value }}, but deployed version is incompatible'

- alert: SubgraphIndexingLag
  expr: subgraph_indexing_lag_blocks > 1000
  for: 10m
  annotations:
    summary: 'Subgraph {{ $labels.version }} lagging >1000 blocks behind chain head'

- alert: SubgraphErrorRateHigh
  expr: rate(subgraph_query_errors_total[5m]) > 0.05
  annotations:
    summary: 'Subgraph {{ $labels.version }} error rate >5%'
```

## Subgraph Deployment Automation

### CI/CD Pipeline

```yaml
# .github/workflows/subgraph-deploy.yml
name: Deploy Subgraph

on:
  push:
    tags:
      - 'subgraph-v*'

jobs:
  deploy-testnet:
    runs-on: ubuntu-latest
    steps:
      - name: Extract version
        run: echo "VERSION=${GITHUB_REF#refs/tags/subgraph-v}" >> $GITHUB_ENV

      - name: Deploy to testnet
        run: |
          graph deploy \
            --network testnet \
            --version-label $VERSION \
            --node https://api.thegraph.com/deploy/ \
            audioblock-testnet
        env:
          GRAPH_DEPLOY_TOKEN: ${{ secrets.GRAPH_DEPLOY_TOKEN_TESTNET }}

      - name: Wait for sync
        run: ./scripts/wait-for-subgraph-sync.sh audioblock-testnet $VERSION

      - name: Run integration tests
        run: npm run test:subgraph:integration

  deploy-mainnet:
    needs: deploy-testnet
    runs-on: ubuntu-latest
    environment: production
    steps:
      - name: Deploy to mainnet staging
        run: |
          graph deploy \
            --network mainnet \
            --version-label $VERSION-staging \
            --node https://api.thegraph.com/deploy/ \
            audioblock-mainnet-staging
        env:
          GRAPH_DEPLOY_TOKEN: ${{ secrets.GRAPH_DEPLOY_TOKEN_MAINNET }}

      - name: Enable canary traffic
        run: ./scripts/enable-canary.sh $VERSION 10

      - name: Monitor canary for 4 hours
        run: ./scripts/monitor-canary.sh $VERSION 4h

      - name: Promote to production
        run: ./scripts/promote-subgraph.sh $VERSION
```

## Version Changelog

Maintain a changelog in the subgraph repository:

```markdown
# Changelog

## [2.0.0] - 2026-10-15

### Breaking Changes

- Renamed `Artist.wallet` to `Artist.walletAddress`
- Changed `walletAddress` type from `String` to `Bytes`

### Migration

- Backend must update queries to use `walletAddress`
- Automatic reindex from genesis required

## [1.3.0] - 2026-09-20

### Added

- New `SocialLink` entity
- `Artist.socialLinks` field

### Fixed

- Royalty calculation for multi-artist tracks
```

## Best Practices

1. **Always test on testnet first** — Never deploy major versions directly to mainnet
2. **Use canary deployments** — Catch issues before full rollout
3. **Monitor version metrics** — Alert on incompatibilities early
4. **Keep deprecation window** — Give clients time to upgrade
5. **Document breaking changes** — Clear migration guides in changelog
6. **Automate deployments** — Reduce human error with CI/CD
7. **Version backend dependencies** — Lock compatible subgraph versions in code

## Rollout Checklist

### Pre-deployment

- [ ] Version number incremented correctly (major/minor/patch)
- [ ] Changelog updated with changes
- [ ] Integration tests pass on testnet
- [ ] Performance benchmarks meet baseline
- [ ] Rollback plan documented

### Deployment

- [ ] Deploy to testnet, verify sync
- [ ] Deploy to mainnet staging
- [ ] Enable canary traffic (10%)
- [ ] Monitor error rates for 4 hours
- [ ] Promote to production

### Post-deployment

- [ ] Update backend `GRAPH_SUBGRAPH_URL` config
- [ ] Monitor metrics for 24 hours
- [ ] Deprecate old version after 7 days
- [ ] Update documentation

## Future Improvements

- **Automatic version detection** — Backend queries subgraph for version on startup
- **Multi-version query adapter** — Transparent query translation between schema versions
- **Progressive rollout** — Gradual traffic shift from 0% → 100% over hours
- **Automated rollback** — Trigger rollback on error rate threshold
- **Version-specific caching** — Cache queries per subgraph version to prevent stale data

## References

- [The Graph Documentation: Versioning](https://thegraph.com/docs/en/cookbook/upgrading-a-subgraph/)
- [Semantic Versioning 2.0.0](https://semver.org/)
- [ADR-009: GraphQL Query Layer](./adrs/009-graphql-query-layer-spike.md)
- [Indexer Guide](./INDEXER_GUIDE.md)
- Issue #663: Define versioning strategy for subgraph upgrades
