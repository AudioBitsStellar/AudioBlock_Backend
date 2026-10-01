# Subgraph Schema and Relationships

The canonical schema is [subgraph/schema.graphql](../subgraph/schema.graphql). Contract events are decoded by the handlers listed in [subgraph/subgraph.yaml](../subgraph/subgraph.yaml); those handlers persist the entities described below. `@derivedFrom` collections are reverse lookups and are not stored as arrays on the parent entity.

## Entity map

| Entity                                   | Purpose                                                           | Main relationships                                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `Artist`                                 | Artist profile and aggregate counters                             | `tracks`, `albums`, `sales`, `mints`, and `events` are derived from their child entity's `artist` field                |
| `Song`                                   | Track metadata, ownership, listing state, and engagement counters | Required `artist`, optional `album`; derived `sales`, `transfers`, `mints`, `likes`, `comments`, `plays`, and `events` |
| `Album`                                  | Artist collection and track grouping                              | Required `artist`; derived `tracks` and `events`                                                                       |
| `Sale`                                   | Completed marketplace sale and price snapshot                     | Required `song` and `artist`                                                                                           |
| `TransferEvent`, `MintEvent`             | Immutable token transfer and mint history                         | Transfer has an optional song; mint requires song and artist                                                           |
| `Like`, `Comment`, `PlayEvent`           | Current likes/comments and immutable play activity                | Each points to a required song                                                                                         |
| `LikeEvent`, `CommentEvent`, `SongEvent` | Song activity history                                             | Each points to a required song                                                                                         |
| `ArtistEvent`, `AlbumEvent`              | Artist and album activity history                                 | Each points to its required parent                                                                                     |
| `Royalty`                                | Royalty split state                                               | Beneficiary and percentage are nullable because the indexed split events contain only a royalty ID                     |
| `RoyaltyEvent`                           | Royalty split and payout history                                  | Required `royalty`                                                                                                     |
| `MarketplaceEvent`                       | Listing and sale event history                                    | Stores seller, optional buyer, event type, and token ID in `data`                                                      |
| `IndexerHealth`                          | Per-network and per-contract indexing counters                    | Standalone operational entity                                                                                          |

## Important fields and identifiers

- Artist IDs are wallet addresses normalized with `toHex()`.
- Song IDs originate in `SongUploaded.songId`. Mint and ERC-721 transfer handlers use the decimal token ID as the song ID. Marketplace events use their token ID to load a song, so these IDs must agree for token activity to update the original song.
- Album IDs and royalty IDs use the string IDs emitted by their contract events.
- Immutable event IDs use `<transaction hash>-<log index>`. Likes use `<song ID>-<user address>`; comments use the comment ID emitted by the contract.
- Aggregate counters live on `Artist` and `Song` for efficient list queries. Event records remain available when a current `Like` or `Comment` is removed.
- `Royalty.beneficiary` and `Royalty.percentage` are nullable: `RoyaltySplitCreated` and `RoyaltyPayoutProcessed` currently emit only `royaltyId`, so the subgraph cannot populate those values from the indexed event stream.

## Event-to-entity ownership

| Data source        | Event handlers                                     | Entities written                                                                           |
| ------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `ArtistFacet`      | `ArtistRegistered`, `ArtistUpdated`                | `Artist`, `ArtistEvent`                                                                    |
| `SongFacet`        | upload, metadata, like, comment, and play handlers | `Song`, `Artist`, `Like`, `LikeEvent`, `Comment`, `CommentEvent`, `PlayEvent`, `SongEvent` |
| `AlbumFacet`       | album create/update and successful song upload     | `Album`, `AlbumEvent`, `Song`, `Artist`, `MintEvent`                                       |
| `ERC721Facet`      | `Transfer`                                         | `Song`, `Artist`, `TransferEvent`, `MintEvent`                                             |
| `MarketplaceFacet` | `ItemListed`, `ItemSold`                           | `Song`, `Artist`, `Sale`, `MarketplaceEvent`                                               |
| `RoyaltyFacet`     | royalty split and payout                           | `Royalty`, `RoyaltyEvent`                                                                  |

## Query example

Nested entities can be fetched in one GraphQL request. Use the entity ID fields and the Graph Node pagination constraints for production list queries.

```graphql
{
  artists(first: 10, orderBy: createdAt, orderDirection: desc) {
    id
    name
    totalTracks
    tracks(first: 20) {
      id
      title
      isListed
      sales(first: 10) {
        buyer
        price
      }
    }
  }
}
```

When changing an entity field or relationship, update the mapping, schema, Matchstick assertions, and any consumer query that selects the affected shape. Schema changes require regenerating mapping types and deploying a new subgraph version.
