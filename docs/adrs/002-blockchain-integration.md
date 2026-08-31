# ADR-002: Blockchain Integration Approach

**Date:** 2024-01-01
**Status:** Accepted
**Deciders:** Core team

## Context

AudioBlock mints music NFTs and distributes royalties on-chain. The requirements are:

- Low transaction fees — artists should not pay high gas to publish a track
- Smart contract support for royalty logic
- Backend must build and sign (or relay) transactions without exposing private keys on the client
- Frontend wallets (Freighter, EVM wallets via Dynamic) must be able to sign transactions constructed by the backend

## Decision

Use **Stellar / Soroban** as the primary blockchain. The backend constructs XDR-encoded transactions using `@stellar/stellar-sdk` and returns them unsigned to the artist's frontend. The artist signs with Freighter and sends the signed XDR back to `POST /api/artist/onchain/submit-xdr` (or the analogous song/marketplace endpoints). The backend then submits to Horizon.

EVM wallet support (Dynamic Labs) is kept as a secondary option for non-Stellar users but does not participate in on-chain royalty contracts.

## Consequences

### Positive

- Stellar transaction fees are a fraction of a cent; minting is economically viable for indie artists
- Soroban smart contracts handle royalty splits deterministically on-chain
- The backend never holds artist signing keys — the XDR relay pattern keeps custody with the user
- `@stellar/stellar-sdk ^16` provides typed contract clients generated from the ABI

### Negative / trade-offs

- Soroban is newer than EVM; tooling (debuggers, block explorers) is less mature
- Developers unfamiliar with Stellar need to learn XDR and Horizon APIs
- Contract upgrades require coordinated ledger migration

### Neutral

- The `src/services/Soroban/` directory encapsulates all chain interactions; routes only call service methods, keeping blockchain logic out of controllers

## Alternatives considered

| Option                   | Why rejected                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Ethereum / Polygon       | Gas fees prohibitive for per-track minting; requires bridging for Stellar users                            |
| Solana                   | Strong tooling but no significant existing user base in the music NFT space; team expertise was on Stellar |
| Off-chain royalty ledger | Doesn't provide trustless, auditable royalty splits — undermines the core value proposition                |
