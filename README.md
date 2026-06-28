# AudioBlocks Backend

The shared API and processing pipeline behind **AudioBlocks**, a music NFT
platform on Stellar/Soroban. It handles user authentication, song/album
upload and transcoding, IPFS metadata pinning, and acts as a **non-custodial
relay** for on-chain actions — it builds and submits Soroban transactions on
an artist's behalf without ever holding their private key.

## Table of Contents

- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Data Model](#data-model)
- [API Reference](#api-reference)
- [The Song Processing Pipeline](#the-song-processing-pipeline)
- [On-Chain Integration: Client Signs, Backend Relays](#on-chain-integration-client-signs-backend-relays)
- [Authentication](#authentication)
- [Environment Variables](#environment-variables)
- [Getting Started](#getting-started)
- [Scripts](#scripts)
- [Known Issues / Cleanup Backlog](#known-issues--cleanup-backlog)

## Architecture

```
                 ┌──────────────┐        ┌──────────────┐
 Artist/Listener │   Frontend    │◀──────▶│   Express API │
      Apps       │ (Next.js)     │  REST  │  (this repo)  │
                 └──────────────┘        └──────┬───────┘
                                                  │
                ┌─────────────────┬──────────────┼───────────────┬──────────────┐
                ▼                 ▼              ▼               ▼              ▼
           PostgreSQL          Redis        RabbitMQ          S3            Stellar/Soroban
         (TypeORM models)   (nonces,      (song_processing  (audio/cover    RPC (transaction
                              manifest      queue)            storage)       relay only —
                              cache)                                         no keys held)
                                              │
                                              ▼
                                     Song Processor Worker
                                  (ffmpeg transcode → HLS,
                                   Pinata/IPFS metadata pin)
```

The HTTP server starts immediately on boot (so deploy-platform health checks
pass) and connects to RabbitMQ — and starts the background worker — only
after the server is already listening; if RabbitMQ is briefly unavailable,
the API still serves requests, just without background song processing.

## Tech Stack

| Concern | Library |
|---|---|
| Runtime / language | Node.js 20, TypeScript 5 |
| Web framework | Express 5 |
| ORM / database | TypeORM 0.3 + PostgreSQL (`pg`) |
| Validation | `class-validator` + `class-transformer` (DTO pattern) |
| Auth | `jsonwebtoken`, `bcrypt` (email/password), `ethers` (EVM wallet-signature verification) |
| File upload | `multer` (chunked audio upload, profile images, cover art) |
| Media processing | `fluent-ffmpeg` (HLS transcoding; requires the system `ffmpeg` binary) |
| Object storage | AWS S3 (`@aws-sdk/client-s3`) |
| Decentralized storage | Pinata (IPFS pinning for NFT metadata) |
| Queueing | RabbitMQ (`amqplib`) — async song-processing jobs |
| Caching | Redis (`ioredis`) — login nonces, signed-manifest cache, OAuth state |
| On-chain (Stellar/Soroban) | `@stellar/stellar-sdk` — transaction building, simulation, and relay |
| On-chain (EVM, legacy) | `ethers`, Dynamic Labs MPC wallet service |

## Project Structure

```
src/
├── index.ts              # entry point: bootstraps DB, server, RabbitMQ, worker
├── app.ts                # Express app: middleware, route mounting, error handlers
├── config/                # db, redis, rabbitmq, s3, soroban, dynamic (EVM) clients
├── controllers/           # one per resource: Auth, ArtistProfile, ArtistOnChain,
│                           #   Song, Upload, User, Wallet
├── dtos/                  # class-validator request shapes
├── entities/               # TypeORM models: User, Song, Album, Genre, TransactionLog
├── middlewares/             # authArtistMiddleware / authListenerMiddleware, validateDTO
├── routes/                 # Express routers, one per resource
├── services/                # business logic, including:
│   ├── Artist/ArtistService.ts        # artist profile + on-chain setup
│   ├── Soroban/SorobanService.ts       # generic prepare/submit relay
│   ├── SongService.ts                  # upload pipeline + on-chain minting
│   ├── AuthService.ts                  # wallet-signature + email/password auth
│   └── UserService.ts
├── workers/                # SongProcessorWorker (active), precomputeManifest
├── seeders/                 # genre seeder, run on every boot
└── utils/, validators/, interfaces/
```

## Data Model

| Entity | Purpose | Notable fields |
|---|---|---|
| **User** | Account record, supports two auth methods | `walletAddress?` (wallet auth), `passwordHash?` (email/password auth), `stellarPublicKey?` / `stellarArtistId?` / `stellarArtistTokenId?` (Soroban identity once an artist connects a wallet and registers on-chain), `role` (`listener` \| `artist` \| `admin`) |
| **Song** | One row per uploaded track | `status` (`processing` \| `ready` \| `failed`) gates streaming; **`mintStatus`** (`not_minted` \| `pending` \| `minted` \| `failed`) is tracked independently — minting is a separate, artist-initiated action, decoupled from whether the song is streamable; `metadataCid`, `onChainSongId`, `onChainTokenId` |
| **Album** | One row per published album | `songs: string[]` (song UUIDs) |
| **Genre** | Lookup table, seeded on boot | — |
| **TransactionLog** | Audit trail of significant actions | `action` (e.g. `CREATE_USER`, `SONG_PROCESSED`), `txHash` |

## API Reference

All protected routes require `Authorization: Bearer <jwt>` and the
appropriate role (`authArtistMiddleware` for artist-only routes).

### Auth — `/api/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/nonce/:email` | — | Generates a login nonce (5 min TTL in Redis) for wallet-signature auth |
| POST | `/register` | — | Wallet-signature signup (`role`, `walletAddress`, `signature`, `message`, `email`, `username`) |
| POST | `/register-listener` | — | Same as above, listener-oriented, no `username` required |
| POST | `/login` | — | Wallet-signature login |
| POST | `/register-email` | — | Email + password signup |
| POST | `/login-email` | — | Email + password login |
| POST | `/2fa/enable` | any authenticated email/password account | Enables TOTP 2FA and returns QR/secret plus backup codes |

### Artist — `/api/artist`

| Method | Path | Auth | Description |
|---|---|---|---|
| PATCH | `/update-profile` | artist | Updates bio/website/etc., accepts `profileImage`/`pageCover` uploads |
| POST | `/onchain/connect-wallet` | artist | Records the artist's Stellar public key |
| POST | `/onchain/prepare-setup` | artist | Builds an unsigned `setup_artist_profile` Soroban transaction |
| POST | `/onchain/submit-setup` | artist | Submits the wallet-signed transaction, persists the resulting artist/token IDs |

### Song — `/api/song`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/upload/chunk` | artist | Uploads one chunk of a large audio file |
| POST | `/upload/cover` | artist | Uploads cover art, pushes to S3 |
| POST | `/upload/finalize` | artist | Merges chunks, creates the `Song` row, queues background processing |
| GET | `/stream/:id` | — | Returns the song's HLS manifest (presigned S3 URLs), cached in Redis |
| POST | `/:id/onchain/prepare-mint` | artist | Builds an unsigned `upload_and_mint_song` Soroban transaction |
| POST | `/:id/onchain/submit-mint` | artist | Submits the wallet-signed mint transaction |

### Wallet — `/api/wallet` (EVM, Dynamic Labs)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/evm/create` | — | Creates an MPC-backed EVM wallet via Dynamic Labs |
| POST | `/evm/signMessage` | — | Signs a message with a Dynamic-managed wallet |

### Twitter OAuth — `/api/auth/twitter`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/init` | artist | Starts the OAuth2 PKCE flow, redirects to Twitter |
| GET | `/callback` | — | Twitter's redirect target; links the account to the authenticated user |

## The Song Processing Pipeline

Upload and minting are deliberately decoupled: a song becomes **streamable**
as soon as background processing finishes, with **minting left as a
separate step the artist triggers afterward** by signing a transaction.

1. **Chunked upload** (`POST /song/upload/chunk` × N) — the client splits
   the audio file client-side and uploads it in pieces.
2. **Finalize** (`POST /song/upload/finalize`) — the backend merges the
   chunks into one file, uploads it to S3, creates the `Song` row
   (`status: "processing"`), and enqueues a job on the `song_processing`
   RabbitMQ queue.
3. **Background worker** (`SongProcessorWorker`, consuming that queue):
   - Transcodes the merged audio to **HLS** via `ffmpeg`.
   - Uploads every HLS segment + the master playlist to S3.
   - Pins the cover art and a generated NFT-style metadata JSON
     (name, artist, description, `animation_url`, attributes) to **IPFS**
     via Pinata.
   - Updates the `Song` row: `status: "ready"`, `hlsMasterUrl`,
     `metadataCid`.
   - Pre-warms the signed-manifest cache and writes a `TransactionLog`
     entry.
4. **Streaming** (`GET /song/stream/:id`) — serves a presigned-URL HLS
   manifest, cached in Redis for a few minutes at a time, regenerated on
   cache miss.
5. **Minting** (separate, artist-initiated, any time after step 3
   finishes) — see below.

## On-Chain Integration: Client Signs, Backend Relays

The backend **never holds an artist's Stellar secret key**. Every on-chain
write follows the same three-step relay pattern, implemented once in
`SorobanService` and reused for both artist setup and song minting:

1. **Prepare** (`prepareInvocation`) — given the artist's *public* key, the
   target contract, and the method/args, the backend fetches the artist's
   on-chain account, builds the contract-call operation, and asks Soroban
   to simulate/assemble the transaction. Returns the **unsigned transaction
   as XDR**.
2. **Sign** (client-side, not in this repo) — the artist's wallet (e.g.
   Freighter) signs the XDR. The artist's address is both the fee-paying
   source account and the address being authorized, so a single client-side
   signature is sufficient.
3. **Submit** (`submitSignedTransaction`) — the backend takes the
   wallet-signed XDR the client sends back, submits it to the Soroban RPC,
   polls until it's confirmed, and decodes the contract's return value.

This pattern powers two flows:

- **Artist on-chain setup**: `connect-wallet` (store the public key) →
  `prepare-setup` (build `setup_artist_profile`) → sign in wallet →
  `submit-setup` (persist the resulting `artist_id`/`token_id`).
- **Song minting**: `prepare-mint` (build `upload_and_mint_song`, requires
  `metadataCid` to already exist) → sign in wallet → `submit-mint` (persist
  `onChainSongId`/`onChainTokenId`, set `mintStatus: "minted"`).

See the [`AudioB_Contract_Soroban`](../AudioB_Contract_Soroban) repo for the
contracts themselves.

## Authentication

Two parallel signup/login flows converge on an identical JWT payload, so
downstream code never needs to know which method a user used.

**Wallet-signature (EVM)** — `ethers.verifyMessage` cryptographically
recovers the signing address from a user-provided signature and checks it
matches the claimed wallet address; a nonce embedded in the signed message
(stored in Redis, single-use) prevents replay.

**Email + password** — standard bcrypt-hashed password (12 salt rounds),
compared on login. Email/password accounts can enroll TOTP 2FA via
`POST /api/auth/2fa/enable` with an existing JWT. Enrollment returns the
shared secret, an otpauth URL/QR data URL, and backup recovery codes. Once
enabled, `POST /api/auth/login-email` requires either `twoFactorCode` or
`recoveryCode` in addition to the email/password.

Both issue a JWT (`expiresIn: "1d"`) carrying `id`, `email`, `role`,
`walletAddress`, and profile fields. `authArtistMiddleware` /
`authListenerMiddleware` verify the token and enforce the required role on
protected routes.

## Environment Variables

```bash
# Server
PORT=4000
NODE_ENV=development

# PostgreSQL
POSTGRES_HOST=
POSTGRES_PORT=
POSTGRES_USER=
POSTGRES_PASSWORD=
POSTGRES_DATABASE=

# Redis
REDIS_HOST=
REDIS_PORT=6379
REDIS_USERNAME=
REDIS_PASSWORD=

# RabbitMQ
RABBITMQ_URL=          # required by the background worker queue connection

# Auth
JWT_SECRET=            # required

# AWS S3
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
AWS_BUCKET_NAME=

# Pinata / IPFS
PINATA_JWT=
PINATA_GATEWAY=

# Soroban (Stellar)
SOROBAN_NETWORK=testnet
SOROBAN_TESTNET_RPC_URL=https://soroban-testnet.stellar.org
SOROBAN_TESTNET_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
SOROBAN_TESTNET_NFT_CONTRACT_ID=
SOROBAN_TESTNET_ARTIST_CONTRACT_ID=
SOROBAN_TESTNET_CATALOG_CONTRACT_ID=
SOROBAN_TESTNET_ROYALTY_CONTRACT_ID=
SOROBAN_TESTNET_MARKETPLACE_CONTRACT_ID=
SOROBAN_MAINNET_RPC_URL=https://mainnet.sorobanrpc.com
SOROBAN_MAINNET_NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"
SOROBAN_MAINNET_NFT_CONTRACT_ID=
SOROBAN_MAINNET_ARTIST_CONTRACT_ID=
SOROBAN_MAINNET_CATALOG_CONTRACT_ID=
SOROBAN_MAINNET_ROYALTY_CONTRACT_ID=
SOROBAN_MAINNET_MARKETPLACE_CONTRACT_ID=

# Dynamic Labs (legacy EVM wallet service)
DYNAMIC_ENVIRONMENT_ID=
DYNAMIC_AUTH_TOKEN=
LISK_SEPOLIA_RPC_URL=

# Twitter OAuth2 (PKCE)
TWITTER_CLIENT_ID=
TWITTER_CLIENT_SECRET=
TWITTER_REDIRECT_URI=
TWITTER_SUCCESS_REDIRECT=

# Worker / streaming tuning (optional, sensible defaults exist)
MANIFEST_CACHE_TTL=300
SIGNED_URL_EXPIRES=300
```

> The backend deliberately has **no** environment variable for an artist's
> or platform's Stellar secret key — on-chain writes are always relayed,
> never signed server-side.

### Updating Soroban Contract Addresses

`src/config/soroban.ts` treats the five AudioBlocks Soroban contract IDs as
a versioned per-network config surface. Set `SOROBAN_NETWORK` to `testnet`
or `mainnet`; startup validates that all five IDs for that selected network
are present before the API connects to the database.

When the `AudioB_Contract_Soroban` team redeploys, copy the deployment
output for the matching network into the five env vars with the same network
prefix:

```bash
SOROBAN_TESTNET_NFT_CONTRACT_ID=
SOROBAN_TESTNET_ARTIST_CONTRACT_ID=
SOROBAN_TESTNET_CATALOG_CONTRACT_ID=
SOROBAN_TESTNET_ROYALTY_CONTRACT_ID=
SOROBAN_TESTNET_MARKETPLACE_CONTRACT_ID=
```

For mainnet, use the same names with `SOROBAN_MAINNET_`. Commit updates to
deployment secret stores or environment dashboards together with the contract
repo deployment tag/commit in the release notes so backend and contract
versions can be traced together.

## S3 Storage and Lifecycle Management

Audio uploads are stored in AWS S3, with a structured prefix strategy to
separate raw uploads, transcoded HLS segments, and cover art.

### Bucket Structure

```
s3://my-bucket/
  uploads/
    raw/           # Raw merged audio files (uploaded by artist)
      {songId}.mp3
    hls/           # Transcoded HLS segments (generated by background worker)
      {songId}/
        master.m3u8
        segment-0.ts
        segment-1.ts
        ...
    covers/        # Cover art and profile images
      {userId}/profile.png
      {songId}/cover.jpg
```

### Lifecycle Policy

To minimize storage costs, define an S3 lifecycle rule that:

1. **Transitions or deletes raw uploads** after successful transcoding.
   - Raw files are only needed during active transcoding; once HLS segments
     exist, the raw file is redundant.
   - Option A: Delete after 7 days (assumes transcoding completes within hours).
   - Option B: Transition to Glacier for long-term cold storage.

2. **Preserves HLS segments and cover art indefinitely** (they serve live
   streams and metadata).

Example lifecycle configuration (AWS console or Terraform):

```json
{
  "Rules": [
    {
      "Id": "DeleteRawAudioAfterTranscode",
      "Filter": { "Prefix": "uploads/raw/" },
      "Status": "Enabled",
      "Expiration": { "Days": 7 }
    }
  ]
}
```

Alternatively, delete the raw file explicitly in the background worker
(`src/workers/SongProcessorWorker.ts`) immediately after HLS transcoding
completes and is uploaded:

```typescript
await s3.deleteObject({
  Bucket: process.env.AWS_BUCKET_NAME,
  Key: `uploads/raw/${song.id}.mp3`,
}).promise();
```

This is more precise (no 7-day lag) and easier to test locally.

## Getting Started

### With Docker (recommended)

```bash
git clone <repo-url>
cd AudioBlock_Backend
cp .env.example .env.docker   # fill in the values above
docker compose up --build
```

This brings up Postgres, Redis, RabbitMQ, pgAdmin (`localhost:5050`), and the
API itself (`localhost:4000`) with hot-reload enabled via
`docker-compose.override.yml`.

### Without Docker

Requires a running PostgreSQL, Redis, and RabbitMQ instance, plus the system
`ffmpeg` binary installed.

```bash
npm install
cp .env.example .env   # fill in the values above
npm run dev
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Hot-reload dev server (`ts-node-dev`) |
| `npm run build` | Compiles TypeScript to `dist/` |
| `npm start` | Runs the compiled build (`dist/index.js`) |
| `npm run worker` | Runs the song-processing worker as a standalone process, independent of the API process — useful for scaling workers separately |
| `npm run seed:genres` | Manually re-runs the genre seeder (also runs automatically on every boot) |

## Known Issues / Cleanup Backlog

- `src/routes/twitterRoutesOld.ts` and `src/workers/transcode.worker.ts` are
  unused/superseded code paths still present in the repo.
- `GET /redis-test` in `src/app.ts` is a debug-only endpoint with no auth —
  should be removed before production use.
- `UserController.ts` exists with several methods (`getAllUsers`,
  `getUserById`, etc.) but has no route file wiring it up.
- A handful of variables in `.env.example` (`REDIS_URL`, `JWT_EXPIRER_AT`,
  `PRIVATE_KEY`, `PRIVATE_KEY_2`, several OAuth1-style Twitter vars) are not
  currently read by any code.
