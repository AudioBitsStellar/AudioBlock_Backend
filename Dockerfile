# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
# Drop dev dependencies once the build has produced dist/, so the production
# stage can copy the tree instead of re-installing it.
RUN npm prune --omit=dev

# Production stage
FROM node:20-alpine
WORKDIR /app

# Install ffmpeg (required by fluent-ffmpeg) with minimal footprint
RUN apk add --no-cache ffmpeg

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy only production deps.
#
# `npm ci --omit=dev` used to run here, and it could not work: `npm ci` executes
# the root `prepare` script (`husky`), and husky is a devDependency that
# `--omit=dev` just removed — the step failed with `sh: husky: not found`
# (npm error code 127) and no image was ever produced (Issue #966). Pruning the
# builder's already-resolved tree keeps the lockfile authoritative, runs no
# lifecycle scripts, and needs no registry access.
COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

# Everything the container writes at runtime lives under /app/uploads (chunked
# uploads, merged files, HLS segments) or os.tmpdir(). Creating and owning these
# up front is what lets the prod manifests mount a named volume over /app/uploads
# and run the rest of the filesystem read-only (Issue #966).
RUN mkdir -p \
    uploads/temp \
    uploads/merged \
    uploads/profile-images \
    uploads/page-covers \
    uploads/covers \
    uploads/hls \
  && chown -R appuser:appgroup /app/uploads

USER appuser

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/health/live', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/index.js"]
