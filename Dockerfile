# Use node image
FROM node:20

# Install ffmpeg (required by fluent-ffmpeg)
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json and install deps
COPY package*.json ./
RUN npm install

# Copy rest of the source code
COPY . .

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 4000

# Liveness probe (Issue #146): container is marked unhealthy if the process
# stops responding on /health/live. Uses Node's http module so no extra
# packages (curl/wget) are needed in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/health/live', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Start the app
CMD ["node", "dist/index.js"]
