# AI Feature Set & Per-Artist Opt-In/Opt-Out

This document describes the current AI / ML-related feature surface of the
AudioBlock Backend, what data (if any) is sent where, and the mechanism for a
per-artist opt-in / opt-out.

> **Status (as of this doc):** the backend has **no live third-party AI / LLM /
> generative-AI integrations**. A codebase sweep for `openai`, `anthropic`,
> `claude`, `gemini`, `gpt`, `llm`, `stable-diffusion`, transcription, and
> related terms found no shipped integration that sends your data to an
> external AI provider. The "AI-adjacent" features below are deterministic,
> rule-based, or human-review driven — **none of them transmit song audio,
> lyrics, or user content to a machine-learning/LLM provider.**

---

## What "AI-adjacent" features exist today

None of the following call an LLM or generative model; they are deterministic
and run on either the node process or the SQL database.

### 1. Song cloud-streaming & manifest pre-computation
- **Where:** `src/workers/precomputeManifest.ts`, `SongController.stream`.
- **What it does:** transcodes audio (via `fluent-ffmpeg`) into HLS segments
  and pre-computes signed streaming manifests.
- **Data sent:** none to third parties — audio stays on S3 / IPFS, signing
  happens locally.

### 2. Moderation (flag / unflag, bulk actions)
- **Where:** `src/services/Song/SongModerationService.ts`, `ContentReport`,
  `TakedownRequest`, `AdminController`.
- **What it does:** human/admins **flag** a song for review (`flag`,
  `flag_for_review`, `approve`, `reject`), backed by `Song.flagged`,
  `flaggedAt`, `flaggedBy` and an audit log. Deterministic state transitions
  (no ML classification).
- **Data sent:** none to third parties; flags are stored locally.

### 3. Search
- **Where:** `src/services/SearchIndexService.ts`.
- **What it does:** an inverted index (Redis) for song lookup. Deterministic
  tokenization — **not** semantic/vector search, no embeddings.

### 4. Recommendations / discovery
- No collaborative-filtering or ML recommendation engine is present today.

---

## What data is sent to third-party providers (non-AI)

For completeness, the following outbound destinations exist — but they are
**storage / blockchain**, not AI analysis. None of these are model inference
endpoints and none receive prompts or generate content:

| Destination | Purpose | Data sent | When |
|---|---|---|---|
| **Pinata / IPFS** (`src/services/PinataService.ts`) | Content-addressed storage | Audio files, cover art, metadata JSON | After upload / transcode |
| **AWS S3** (bucket `raw/`, `hls/`, `covers/`) | Object storage | Raw audio, HLS segments, covers | During upload pipeline |
| **Stellar / Soroban** (`src/config/soroban.ts`) | On-chain metadata | Minted song metadata / CIDs | When minting |
| **Dynamic Labs** (EVM) | Wallet-based auth | Wallet address, signature nonces | On login |

---

## Per-artist opt-in / opt-out

### What exists today (real mechanism)

There is **no AI-specific opt-in/opt-out toggle** in the code or database today
(because no AI features exist). The closest real, shipped control is the
**profile privacy toggle**:

- **Field:** `User.isProfilePublic` (boolean, default `true`).
- **Where:** `src/services/UserService.ts` (`updateProfile` with
  `isProfilePublic`; enforced in `getPublicProfile`, Issue #83).
- **Effect:** when `false`, public profile reads return
  `{ private: true }` — even the user's own profile fields are withheld from
  public endpoints. A privacy toggle intended to control how much a creator's
  content is exposed to derived/aggregated surfaces.

### Intended mechanism (design, not yet implemented)

The intended per-artist AI opt-in/opt-out, once any AI feature ships, should:

1. Be a **dedicated, default-`false` flag** (e.g. `User.aiFeatureOptIn`),
   separate from `isProfilePublic`, so visibility of a profile and inclusion in
   AI-derived features are orthogonal.
2. Be toggled by the artist only (`PATCH /api/artist/profile/settings`),
   one setting controlling **all** AI features at once (not per-feature).
3. When opted out, ensure no content is submitted to any AI/LLM provider and
   no derived outputs are generated.
4. Be enforceable server-side (a guard at the service layer), not just a UI
   switch.

Until an AI feature exists and this flag is implemented, the code contains only
the `isProfilePublic` privacy toggle described above.
