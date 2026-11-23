# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine
WORKDIR /app

# Install ffmpeg (required by fluent-ffmpeg) with minimal footprint
RUN apk add --no-cache ffmpeg

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Install production deps only. package.json's root `prepare` hook runs `husky`, a
# devDependency, and npm fires lifecycle scripts of the root package even under
# --omit=dev, so this layer aborts with `sh: husky: not found` (exit 127). Dropping the
# hook here is the narrowest fix: HUSKY=0 cannot work because that flag is read by husky
# itself, which is the very binary --omit=dev refuses to install, and --ignore-scripts
# would also skip bcrypt's native build, which this image needs at runtime.
COPY package*.json ./
RUN npm pkg delete scripts.prepare && npm ci --omit=dev && npm cache clean --force

# Copy built artifacts from builder
# Runtime needs nothing else from the builder: TypeORM resolves migrations from
# dist/config/../migrations (see src/config/db.ts), so dist/ is complete.
COPY --from=builder /app/dist ./dist

USER appuser

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/health/live', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/index.js"]
