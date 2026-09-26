# AudioBlock Subgraph

The Graph subgraph for AudioBlock on Stellar/Soroban. Indexes events from 5 smart contracts (Artist, Song, Album, Royalty, Marketplace) and exposes them via GraphQL.

**Related Issues:**
- #677: CI pipeline to validate subgraph build on PR
- #678: CI pipeline to auto-deploy subgraph on merge to main
- #679: RPC fallback when subgraph unavailable
- #681: Indexer backfill from contract deployment block

## Setup

### Prerequisites

- Node.js 20+
- The Graph CLI: `npm install -g @graphprotocol/graph-cli`

### Installation

```bash
cd subgraph
npm install
```

### Configuration

Environment variables required for deployment (in GitHub Actions secrets):

```
GRAPH_DEPLOY_TOKEN_TESTNET  # The Graph Studio API token for testnet
GRAPH_DEPLOY_TOKEN_MAINNET  # The Graph Studio API token for mainnet
GRAPH_DEPLOY_TOKEN          # Optional shared fallback token
```

The deploy script reads the environment-specific token first, then falls back to
`GRAPH_DEPLOY_TOKEN`. Do not commit Studio deploy tokens or query API keys.

Contract addresses are passed via environment variables in subgraph.yaml substitution:

```bash
# Example for development
export ARTIST_FACET_ADDRESS=CXXX...
export SONG_FACET_ADDRESS=CYYY...
# ... (see subgraph.yaml for all required addresses)
```

## Usage

### Generate Types

Generates TypeScript types from the GraphQL schema and contract ABIs:

```bash
npm run codegen
```

### Build Subgraph

Validates the schema, mappings, and ABIs:

```bash
npm run build
```

This step is run in CI on every PR (#677) to catch issues early.

### Deploy to The Graph

#### Testnet (automatic on merge to main)

```bash
npm run deploy:testnet
```

#### Mainnet (manual, requires explicit deploy)

```bash
npm run deploy:mainnet
```

The deploy commands call `scripts/deploy.js`, which wraps `graph deploy` with
the correct Studio slug and access token:

```bash
GRAPH_DEPLOY_TOKEN_TESTNET=... npm run deploy:testnet
GRAPH_DEPLOY_TOKEN_MAINNET=... npm run deploy:mainnet
```

## Architecture

### Schema

The GraphQL schema (`schema.graphql`) defines entities for:
- **Artist** - Artists and their events
- **Song** - Songs and metadata
- **Album** - Albums and collections
- **Royalty** - Royalty splits and payouts
- **Marketplace** - Buy/sell events

### Mappings

Event handlers in `src/mappings/` decode Soroban contract events and map them to schema entities:

- `artist.ts` - Artist registration and updates
- `song.ts` - Song uploads and metadata changes
- `album.ts` - Album creation and updates
- `royalty.ts` - Royalty split and payout events
- `marketplace.ts` - Listing and sale events

### Data Sources

Each contract facet is a separate data source in `subgraph.yaml`, polling events independently.

## RPC Fallback

If the subgraph is unavailable or undeployed, the backend automatically falls back to direct Soroban RPC queries via `SubgraphQueryService` (#679).

**When fallback is used:**
- Subgraph query returns 5xx or timeout
- Service is not yet deployed to The Graph
- Network connectivity issues

**Configuration:**

```env
GRAPH_SUBGRAPH_URL=https://api.studio.thegraph.com/query/...
GRAPH_SUBGRAPH_API_KEY=... # optional bearer token for endpoints that support it
GRAPH_SUBGRAPH_ENDPOINT_TEMPLATE=https://gateway.thegraph.com/api/{apiKey}/subgraphs/id/<SUBGRAPH_ID>
SUBGRAPH_ENABLED=false  # Set to true once deployed
SUBGRAPH_FALLBACK_ENABLED=true
```

Use either `GRAPH_SUBGRAPH_URL` for a complete endpoint or
`GRAPH_SUBGRAPH_ENDPOINT_TEMPLATE` plus `GRAPH_SUBGRAPH_API_KEY` when the query
API key must be embedded in the gateway URL. Health reports redact the configured
API key.

## Backfill & Historical Data

Backfill historical events from contract deployment block using the auto-discovery feature (#681):

```bash
# Auto-discover deployment ledger and backfill
npm run cli:reindex -- backfill:auto --contract CXXX... --network testnet

# Manual backfill with explicit ledger range
npm run cli:reindex -- backfill:run --contract CXXX... --network testnet --start 100000 --end 200000

# Check backfill status
npm run cli:reindex -- backfill:status --contract CXXX... --network testnet
```

See [../docs/indexer-backfill-runbook.md](../docs/indexer-backfill-runbook.md) for details.

## CI/CD Pipelines

### PR Validation (.github/workflows/subgraph-validate-pr.yml)

Runs on every PR with changes to `subgraph/`:

1. Validates schema.graphql
2. Validates subgraph.yaml manifest
3. Generates types (codegen)
4. Attempts build
5. Posts feedback comment to PR

### Main Deployment (.github/workflows/subgraph-deploy-main.yml)

Runs on merge to main:

1. Same validation as PR workflow
2. Deploys to The Graph Studio (testnet by default)
3. Manual workflow dispatch for mainnet deployment

## Monitoring

### Metrics

Once deployed, monitor:

- Query latency from The Graph API
- Indexing progress (sync status)
- Fallback usage rate (when subgraph unavailable)
- Event ingestion lag

### Logs

Check indexer worker logs for fallback events:

```bash
docker logs <indexer-worker-container> | grep "fallback"
```

## Troubleshooting

### Build fails with "schema.graphql not found"

Ensure you're running from the `subgraph/` directory or specify full path.

### Codegen fails

Run `npm install` again and check for TypeScript/Graph CLI version mismatches.

### Deployment fails with "Unauthorized"

Check `GRAPH_DEPLOY_TOKEN` environment variable is set and valid in GitHub Actions secrets.

### Subgraph lags behind

Check if RPC provider is rate-limited. Backfill from deployment block and resume live polling.

## References

- [The Graph Documentation](https://thegraph.com/docs/)
- [Soroban Integration Guide](../../docs/adrs/010-indexer-architecture.md)
- [Backfill Runbook](../../docs/indexer-backfill-runbook.md)
- ADR-009: GraphQL Query Layer
- ADR-010: Blockchain Event Indexer Architecture
