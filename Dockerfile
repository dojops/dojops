# ── Build stage ──────────────────────────────────────────────────────
FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

WORKDIR /app

# Copy lockfile and workspace manifests first for layer caching
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.json ./
COPY packages/core/package.json packages/core/
COPY packages/sdk/package.json packages/sdk/
COPY packages/planner/package.json packages/planner/
COPY packages/runtime/package.json packages/runtime/
COPY packages/executor/package.json packages/executor/
COPY packages/scanner/package.json packages/scanner/
COPY packages/session/package.json packages/session/
COPY packages/context/package.json packages/context/
COPY packages/skill-registry/package.json packages/skill-registry/
COPY packages/api/package.json packages/api/
COPY packages/mcp/package.json packages/mcp/
COPY packages/cli/package.json packages/cli/

RUN pnpm install --frozen-lockfile

# Copy source and build
COPY packages/ packages/
RUN pnpm build

# Prune dev dependencies
RUN pnpm prune --prod

# ── Production stage ────────────────────────────────────────────────
FROM node:20-slim AS production

# Enable pnpm and install common DevOps tools for verification (requires root) # NOSONAR
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate \
    && apt-get update && apt-get install -y --no-install-recommends \
    git \
    make \
    shellcheck \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/node_modules/ node_modules/
COPY --from=builder /app/packages/ packages/
COPY --from=builder /app/package.json .
COPY --from=builder /app/pnpm-workspace.yaml .
COPY --from=builder /app/pnpm-lock.yaml .

# Link CLI globally and create non-root user for runtime (requires root)
RUN pnpm --filter @dojops/cli link --global 2>/dev/null || true \
    && groupadd --gid 1001 dojops && useradd --uid 1001 --gid dojops --shell /bin/sh --create-home dojops \
    && chown -R dojops:dojops /app

ENV NODE_ENV=production
ENV DOJOPS_API_PORT=3000

EXPOSE 3000

# Run as non-root user
USER dojops

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const http = require('http'); http.get('http://localhost:3000/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Default command: start the API server
CMD ["node", "packages/cli/dist/index.js", "serve", "--port=3000"]
