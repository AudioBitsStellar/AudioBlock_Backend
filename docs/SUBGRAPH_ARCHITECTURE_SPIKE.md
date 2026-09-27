# Research & Spike: The Graph Subgraph Architecture for AudioBlock Contracts

## Executive Summary

This architecture spike evaluates adopting **The Graph** as the primary or hybrid indexing layer for AudioBlock smart contracts deployed on Stellar / Soroban.

AudioBlock relies on rapid querying of complex entity relationships:
- Artists and profiles
- Songs, streaming metadata, and engagement (likes, comments)
- Albums and releases
- ERC721 token transfers and mints
- Royalty splits and payout executions
- Decentralized marketplace listings and trades

## Architecture Options Comparison

| Evaluation Metric | Custom Horizon/RPC Poller | The Graph Subgraph | Hybrid Model (Recommended) |
|---|---|---|---|
| **Query Flexibility** | Custom REST endpoints / SQL | Flexible GraphQL queries | GraphQL + Cached REST |
| **Maintenance Burden** | High (custom DB schemas, migrations) | Low (declarative `schema.graphql`) | Moderate |
| **Historical Reorgs** | Manual rollback logic needed | Handled natively by Graph Node | Graph handles reorgs |
| **Latency** | 200-800ms RPC poll | Near real-time (< 2s) | Real-time events + Subgraph queries |
| **Infrastructure Cost** | Dedicated indexer server + DB | Decentralized Network / Studio | Minimal operational overhead |

## Contract Facet Mapping & Data Sources

The subgraph architecture decomposes indexing across the Diamond pattern facets:
1. **ArtistFacet**: Indexes `ArtistRegistered` and `ArtistUpdated` events -> `Artist` entities.
2. **SongFacet**: Indexes `SongUploaded`, `SongLiked`, `SongUnliked`, `CommentAdded` -> `Song`, `Like`, `Comment` entities.
3. **AlbumFacet**: Indexes `AlbumCreated`, `AlbumUpdated`, `SongUploadedSuccessfully` -> `Album` entities.
4. **ERC721Facet**: Indexes `Transfer` -> `TransferEvent`, `MintEvent`, tracking NFT ownership.
5. **RoyaltyFacet**: Indexes `RoyaltySplitCreated`, `RoyaltyPayoutProcessed` -> `Royalty` distributions.
6. **MarketplaceFacet**: Indexes `ItemListed`, `ItemSold` -> `Sale`, `MarketplaceEvent`.

## Subgraph Resilience & Fallback Strategy

To ensure zero downtime during indexer lag or Graph Studio outages:
1. **Circuit Breaker**: When subgraph query latency > 2.5s or returns 5xx, the API gateway automatically routes queries to `OnChainReconciliationService` / direct Stellar RPC.
2. **Deterministic Backfilling**: `startBlock` configured to the exact deployment ledger of the AudioBlock Diamond contract.
3. **Health Check Probes**: Automated health check endpoint verifies subgraph sync status (`_meta { block { number } hasIndexingErrors }`).

## Recommendation & Next Steps

1. Maintain declarative `subgraph/` project scaffold with standard `schema.graphql` and AssemblyScript mappings.
2. Implement automated CI validation (`graph codegen` and `graph build`) on pull requests.
3. Deploy testnet indexer to The Graph Studio.
