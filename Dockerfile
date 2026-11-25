# AudioBlocks backend image — one build, four deployables (Issue #965).
#
# The API, song worker, indexer and scheduler all run from the same compiled
# `dist/`, but they must be deployed, scaled and restarted independently and
# each needs its own health probe. They are modelled as build targets instead
# of a single image plus a `command:` override, so the orchestrator sees four
# distinct images with distinct ports, probes and entrypoints.
#
#   docker build --target api       .   # default when no target is given
#   docker build --target worker    .
#   docker build --target indexer   .
#   docker build --target scheduler .
#
# `docker build .` keeps producing the API image: `api` is the last stage, and
# the CD workflow (deploy.yml) builds without a target.

# ── Build ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Shared runtime ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

# ffmpeg backs fluent-ffmpeg (song worker). postgresql-client ships pg_dump so
# the backup job and the restore drill run inside the image instead of needing
# a sidecar (Issue #968).
RUN apk add --no-cache ffmpeg postgresql-client

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Install production deps only. package.json's root `prepare` hook runs `husky`, a
# devDependency, and npm fires lifecycle scripts of the root package even under
# --omit=dev, so this layer aborts with `sh: husky: not found` (exit 127). Dropping the
# hook here is the narrowest fix: HUSKY=0 cannot work because that flag is read by husky
# itself, which is the very binary --omit=dev refuses to install, and --ignore-scripts
# would also delete sqlite3's compiled binding: the lockfile leaves sqlite3 unflagged as
# dev, so --omit=dev installs it, and only its install script builds node_sqlite3.node.
COPY package*.json ./
RUN npm pkg delete scripts.prepare && npm ci --omit=dev && npm cache clean --force

# Copy built artifacts from builder
# Runtime needs nothing else from the builder: TypeORM resolves migrations from
# dist/config/../migrations (see src/config/db.ts), so dist/ is complete.
COPY --from=builder /app/dist ./dist
# Read at runtime by the swagger route and by the backup/restore scripts.
COPY --from=builder /app/docs ./docs
COPY --from=builder /app/scripts ./scripts

# Writable dump directory; the scheduler's backup volume inherits this owner.
RUN mkdir -p /app/backups && chown -R appuser:appgroup /app/backups
USER appuser

# ── Song-processing worker ───────────────────────────────────────────────────
FROM runtime AS worker
ENV NODE_ENV=production \
    HEALTH_PORT=9466
EXPOSE 9466
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:9466/health/live', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"
CMD ["node", "dist/workers/songWorkerMain.js"]

# ── On-chain indexer ─────────────────────────────────────────────────────────
FROM runtime AS indexer
ENV NODE_ENV=production \
    HEALTH_PORT=9467 \
    INDEXER_METRICS_PORT=9464
EXPOSE 9464 9467
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:9467/health/live', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"
CMD ["node", "dist/workers/indexer/index.js"]

# ── Scheduler (recurring maintenance + daily database backup) ────────────────
FROM runtime AS scheduler
ENV NODE_ENV=production \
    HEALTH_PORT=9468
EXPOSE 9468
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:9468/health/live', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"
CMD ["node", "dist/workers/scheduler.js"]

# ── HTTP API (default target) ────────────────────────────────────────────────
FROM runtime AS api
ENV NODE_ENV=production \
    HEALTH_PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/health/live', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"
CMD ["node", "dist/index.js"]
