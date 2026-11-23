# Legal Review: Open Items

Tracks #984, "Legal review of music licensing, NFT/securities exposure and royalty payouts".

> **Status: counsel sign-off has not been obtained.** This document lists the questions for counsel
> and the facts from the codebase that counsel needs. It contains no legal conclusions. Closing #984
> requires a written sign-off from qualified counsel, and that cannot come from a code change.

## Facts from the codebase

These are descriptions of current behavior. Confirm them before relying on them.

| Area                  | What the code does                                                                                                                                                             | Where                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Uploads and licensing | Artists upload songs and albums. Songs carry a `MINT_SONG` transaction. The takedown workflow exists for copyright and trademark claims.                                       | `src/services/SongService.ts`, `src/services/TakedownService.ts`   |
| On-chain tokens       | Soroban contracts for `nft`, `artist`, `catalog` and `royalty`. The ABIs include an ERC721 facet and a marketplace facet, so tokens are transferable.                          | `src/config/soroban.ts`, `src/abis/`                              |
| Royalty splits        | Each sale produces an expected split for each collaborator, from `SongCollaborator.royaltyShare`. Splits are reconciled against on-chain events.                              | `src/services/RoyaltyPayoutService.ts`                            |
| Payout execution      | Settlement happens on-chain in the royalty contract. The backend records expected payouts and reconciles them. It does not move funds itself.                                 | `src/services/RoyaltyPayoutService.ts`, `src/jobs/RoyaltyReconciliationJob.ts` |
| Payout screening      | A compliance gate blocks recipients under a hold or a sanctions match. On-chain settlement is not screened.                                                                    | `docs/SANCTIONS_SCREENING.md`                                     |
| DMCA                  | A public takedown policy and a designated-agent record exist. The agent is not registered until the operator completes the Copyright Office filing.                          | `docs/DMCA_TAKEDOWN_POLICY.md`                                    |

## Questions for counsel

### Music licensing

1. What license do artists need to grant the platform in order to host, stream and sell their music?
2. Does the current takedown process meet the notice-and-takedown requirements for the markets we
   operate in? See `docs/DMCA_TAKEDOWN_POLICY.md`.
3. What do we need to do about collective licensing and performance-rights organizations?

### NFT and securities exposure

4. Do the song and artist tokens, or the royalty rights attached to them, count as securities in any
   jurisdiction we serve? The answer depends on how they are sold and what the buyer is promised.
5. Does the marketplace need a registration exemption or other filings for secondary sales?
6. Are there disclosure or marketing rules that apply to how royalty-share tokens are described?

### Royalty payouts

7. Does paying royalties to recipients, possibly across borders, require a payment or money
   transmission licence?
8. What tax reporting obligations apply to artists and to the platform (for example, information
   returns)?
9. What sanctions and AML obligations apply to payouts? See `docs/SANCTIONS_SCREENING.md`. The
   screening provider has not been chosen yet.

## Sign-off

| Item                          | Owner | Status                   | Date |
| ----------------------------- | ----- | ------------------------ | ---- |
| Counsel name and firm         |       | Not appointed            |      |
| Written sign-off              |       | **Not obtained**         |      |
| Open items from this document |       | Open (9 questions above) |      |
