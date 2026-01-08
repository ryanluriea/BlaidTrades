# Multi-stage Dockerfile for BlaidTrades Trading Platform
# Supports both API and Worker deployment modes

# =============================================================================
# Stage 1: Base image with Node.js
# =============================================================================
FROM node:20-slim AS base

# Install essential system dependencies
RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# =============================================================================
# Stage 2: Dependencies installation
# =============================================================================
FROM base AS deps

# Copy package files
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# =============================================================================
# Stage 3: Build the application
# =============================================================================
FROM deps AS builder

# Copy source files
COPY . .

# Build frontend (Vite) and backend (esbuild)
RUN npm run build

# =============================================================================
# Stage 4: Production image
# =============================================================================
FROM base AS production

# Create non-root user for security
RUN groupadd -r appgroup && useradd -r -g appgroup appuser

WORKDIR /app

# Copy package files and install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built assets from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# Copy shared types (needed at runtime for some imports)
COPY --from=builder /app/shared ./shared

# Copy data directory for SQLite cache (if used)
COPY --from=builder /app/data ./data

# Set ownership
RUN chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:5000/api/health || exit 1

# Environment variables (defaults - override in ECS task definition)
ENV NODE_ENV=production
ENV PORT=5000

# Default command - API mode
# For workers, override with: ["node", "--max-old-space-size=8192", "dist/index.js", "--worker-only"]
CMD ["node", "--max-old-space-size=12288", "dist/index.js"]
