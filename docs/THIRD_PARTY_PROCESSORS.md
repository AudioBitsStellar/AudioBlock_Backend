# Third-Party Processors

Register of the third-party services that receive or handle personal data for AudioBlocks. It is built from the code, and each row cites where the integration lives. Issue COMP-05 asks for this register and for a Data Processing Agreement (DPA) on file for each processor.

**Status legend**

- **Not confirmed**: the code shows the integration, but nobody has verified that a signed DPA is on file. The register cannot show this. The account owner must confirm it.
- **Not applicable**: the integration is off, or no vendor is wired up in this build.

Update this file whenever a processor is added, removed or switched on. Add the DPA reference and the date it was confirmed.

## Register

| # | Processor | What it does for AudioBlocks | Personal data sent | Where in code | Enabled by | DPA status |
| - | --------- | ---------------------------- | ------------------ | ------------- | ---------- | ---------- |
| 1 | **Privy** (`auth.privy.io`) | Delegated authentication: login, sessions, MFA, webhooks for account events | Email address, Privy user ID (`did:privy:…`), linked wallet or social identifiers, login metadata | `src/services/privy/`, `src/config/privy.ts`, `src/controllers/PrivyWebhookController.ts` | `AUTH_MODE` / `PRIVY_APP_ID` | Not confirmed |
| 2 | **Pinata** (IPFS) | Pins NFT and song metadata and serves cover art through the gateway | Artist and track metadata, cover art, artist display name where it is part of the metadata | `src/services/PinataService.ts`, `src/utils/ipfs.ts`, `src/services/CoverArtService.ts` | `PINATA_JWT`, `PINATA_GATEWAY` | Not confirmed |
| 3 | **Amazon Web Services S3** | Stores uploaded audio, cover art and profile images. Serves presigned URLs for streaming | Uploaded media (may contain artist identity), profile images | `src/config/s3.ts`, `src/utils/s3.ts`, `src/services/SongService.ts`, `src/services/ArtistProfileService.ts` | `AWS_BUCKET_NAME`, `AWS_REGION`, AWS credentials | Not confirmed. Check the AWS DPA in AWS Artifact and confirm it is accepted on the account. |
| 4 | **Transactional email provider**: **Resend** (default) or **SendGrid** | Sends verification, password reset and other transactional email. Receives bounce and complaint events through the webhook | Email address, message content (verification and reset links), bounce and complaint metadata | `src/services/EmailService.ts`, `src/workers/JobQueueWorker.ts`, `src/controllers/EmailEventController.ts` | `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_EVENTS_WEBHOOK_SECRET` | Not confirmed. Record a DPA for whichever provider is selected in production. |
| 5 | **X (Twitter) API** | Optional. Lets an artist link an X account via OAuth | X user ID, username, display name, OAuth tokens | `src/routes/twitterRoutes.ts` | `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET` | Not confirmed. X uses its developer terms, not a separate DPA. Confirm the terms are accepted. |
| 6 | **Stellar Soroban RPC** (`soroban-testnet.stellar.org`, `mainnet.sorobanrpc.com`) | Simulates and submits transactions for on-chain actions | Stellar public keys (pseudonymous, and already public on-chain) | `src/config/soroban.ts`, `src/services/Soroban/` | `SOROBAN_*_RPC_URL` | Not applicable as a DPA. The public RPC endpoints publish no DPA. If a private RPC provider is used, sign its DPA. |
| 7 | **Dynamic Labs** (legacy EVM MPC wallets) | Legacy wallet creation and signing | Wallet identifiers | `src/config/dynamic.ts`, `src/services/Dynamic/`, `src/utils/dynamicUtils.ts` | `ENABLE_LEGACY_EVM_AUTH=false` (off by default; routes return 410) | Not applicable while disabled. Confirm a DPA before enabling. |
| 8 | **AI providers** | AI-assisted features (`src/services/AI/`) | Prompts and any user content sent to the model | No vendor is wired up in this build. `AI_PROVIDER` falls back to a no-op or mock adapter (`src/services/AI/index.ts`). | `AI_PROVIDER`, `AI_OPENAI_API_KEY`, `AI_ANTHROPIC_API_KEY` (keys are read but no adapter uses them yet) | Not applicable today. **Before any vendor is enabled**, add a row here, sign a DPA and update the AI data-retention notes in `docs/AI_DATA_RETENTION.md`. |
| 9 | **Log aggregator** (optional) | Ships structured logs off the host | Request metadata, IP addresses, user IDs. Sensitive headers and body fields are redacted first. | `src/config/logger.ts` (`createHttpLogShipper`) | `LOG_AGGREGATOR_URL` | Not confirmed. Only applies when the variable is set. |
| 10 | **Hosting and data stores** (PostgreSQL, Redis, RabbitMQ, container host) | Store and run the platform | All platform data | `docker-compose*.yml`, `docs/PRODUCTION_DEPLOYMENT.md` | Deployment config | **Owner to complete.** The hosting provider is not named in this repository. |

## Notes for the account owner

- The **DPA** column is the open item for COMP-05. Only the account holder can sign or accept a DPA. Mark a row "Confirmed" here only after the signed copy or the accepted terms are on file. Keep the copy in the compliance folder, not in this repository.
- Where a row says "Not applicable", the reason is stated. Re-check it before each production release. The reasons go stale when a flag flips or a vendor is added.
- International transfers: Privy, Pinata, AWS, the email provider and X may process data outside the EU or UK. Each processor's DPA should cover the transfer mechanism that applies.

## Related documents

- [Age policy](AGE_POLICY.md)
- [Email deliverability](EMAIL_DELIVERABILITY.md)
- [AI data retention](AI_DATA_RETENTION.md)
- [GDPR AI ability](GDPR_AI_ABILITY.md)
- [Environment variables](environment-variables.md)
