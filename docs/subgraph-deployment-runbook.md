# Subgraph Deployment Runbook

This runbook covers deploying changes to the AudioBlock subgraph on The Graph Studio. Testnet deploys automatically after a change under `subgraph/` is merged to `main`; mainnet deploys require a manual workflow dispatch or an explicitly run local deployment.

## Before merging

1. Review the schema and mapping changes together. A required schema field must be populated by every handler that creates that entity.
2. Add/update Matchstick mapping tests and regenerate Graph types when the schema or ABIs change.
3. Open a PR against `main`. The subgraph validation workflow installs dependencies, generates types, runs Matchstick tests, and builds the subgraph.
4. Confirm the PR checks are green and have the required review before merging. Merging a subgraph change triggers the testnet deployment workflow.

Local validation from the repository root:

```bash
cd subgraph
npm install
npm run codegen
npm test
npm run build
```

## GitHub configuration

Create GitHub Environments named `subgraph-testnet` and `subgraph-mainnet`. Configure environment variables in each environment for every contract address and the first ledger to index:

| Variable                    | Used for                                                |
| --------------------------- | ------------------------------------------------------- |
| `ARTIST_FACET_ADDRESS`      | Artist facet address                                    |
| `SONG_FACET_ADDRESS`        | Song facet address                                      |
| `ALBUM_FACET_ADDRESS`       | Album facet address                                     |
| `ERC721_FACET_ADDRESS`      | ERC-721 facet address                                   |
| `ROYALTY_FACET_ADDRESS`     | Royalty facet address                                   |
| `MARKETPLACE_FACET_ADDRESS` | Marketplace facet address                               |
| `START_BLOCK`               | Deployment ledger from which Graph Node starts indexing |

Set `GRAPH_DEPLOY_TOKEN_TESTNET` and `GRAPH_DEPLOY_TOKEN_MAINNET` as environment secrets. `GRAPH_DEPLOY_TOKEN` is supported as a shared fallback. Never put deploy tokens in repository variables or source files. The deployment workflow selects the matching environment so its addresses, start block, and token are passed to the Graph CLI.

## Automatic testnet deployment

On merge to `main`, `.github/workflows/subgraph-deploy-main.yml` performs these steps in `subgraph/`:

1. Installs Node.js 20 dependencies.
2. Generates types and builds the subgraph manifest and mappings.
3. Authenticates with the testnet Studio token and deploys `AudioBitsStellar/audioblock-testnet`.
4. Reports success or failure in the Actions run summary.

Follow the workflow run to completion before validating queries. Confirm in The Graph Studio that the new deployment is indexing and has no indexing errors; then query its GraphQL endpoint and check the indexed block is advancing.

## Manual mainnet deployment

Use this path only after the testnet deployment and query checks are successful and the mainnet deployment has been approved.

1. Open **Actions** and select **Subgraph - Auto Deploy on Merge to Main**.
2. Choose **Run workflow**, select the `main` branch, and choose `mainnet`.
3. Review the run and its environment protection approval, if configured.
4. Wait for the build and Studio deployment steps to succeed.
5. In Studio, verify the active version, indexing status, and GraphQL query response before enabling the endpoint for backend clients.

The workflow also supports a manual `testnet` dispatch for a controlled redeploy. Use the environment corresponding to the selected input.

## Local deployment

For a local Graph Node, use the stack documented in the [subgraph README](../subgraph/README.md#local-graph-node-development-659). For Studio deployment from a workstation, first run codegen and build, set the manifest substitutions and an environment-specific deploy token, then run:

```bash
cd subgraph
npm run deploy:testnet
# Explicitly approved mainnet deployment only:
npm run deploy:mainnet
```

The scripts use `GRAPH_DEPLOY_TOKEN_TESTNET` or `GRAPH_DEPLOY_TOKEN_MAINNET`, with `GRAPH_DEPLOY_TOKEN` and `GRAPH_ACCESS_TOKEN` as fallbacks. Set `GRAPH_VERSION_LABEL` to identify a release; otherwise Studio assigns its normal version label. The local commands do not run codegen or build for you.

The legacy hosted-service commands (`deploy:hosted:*`) target a different, legacy endpoint and use `GRAPH_ACCESS_TOKEN`; do not use them for a Studio deployment.

## Failure and rollback

- **Build or codegen failure:** Do not deploy. Fix the schema, manifest, ABI, or mapping error and rerun PR validation.
- **Missing/unauthorized token:** Check the selected GitHub Environment and environment secret name. Do not copy the secret into logs or PR comments.
- **Subgraph fails to sync:** Check the deployment log, configured contract addresses, `START_BLOCK`, and Graph Node indexing status before changing backend query configuration.
- **Bad deployment:** Keep the previous working Studio version available. In Studio, promote/revert to the previous known-good version, then verify indexing and representative GraphQL queries before switching consumers back.

Record the workflow URL, deployed version label, environment, and verification result in the release or incident record. Do not deploy mainnet merely to recover a failing testnet deployment.
