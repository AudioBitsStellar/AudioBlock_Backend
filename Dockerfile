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

# Copy only production deps
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

# Copy any runtime assets (migrations, seeds, etc.) if needed
COPY --from=builder /app/src ./src 2>/dev/null || true

USER appuser

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/health/live', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/index.js"]
