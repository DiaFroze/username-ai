# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root manifests
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/checker-engine/package.json ./packages/checker-engine/
COPY packages/ai-engine/package.json ./packages/ai-engine/
COPY packages/db/package.json ./packages/db/
COPY apps/api/package.json ./apps/api/
COPY apps/bot/package.json ./apps/bot/
COPY apps/miniapp/package.json ./apps/miniapp/

# Install all dependencies
RUN npm ci

# Copy source files
COPY tsconfig*.json ./
COPY packages ./packages
COPY apps/api ./apps/api

# Build packages and API
RUN npm run build -w @username/shared && \
    npm run build -w @username/checker-engine && \
    npm run build -w @username/ai-engine && \
    npm run build -w @username/db && \
    npm run build -w @username/api

# Stage 2: Production Runner
FROM node:22-alpine AS runner

RUN apk add --no-cache curl dumb-init

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0

# Copy root manifests
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/checker-engine/package.json ./packages/checker-engine/
COPY packages/ai-engine/package.json ./packages/ai-engine/
COPY packages/db/package.json ./packages/db/
COPY apps/api/package.json ./apps/api/

# Install only production dependencies
RUN npm ci --omit=dev

# Copy built code
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/checker-engine/dist ./packages/checker-engine/dist
COPY --from=builder /app/packages/ai-engine/dist ./packages/ai-engine/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/drizzle ./packages/db/drizzle
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Security: Non-root execution
USER node

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://127.0.0.1:${PORT:-4000}/health/live || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/api/dist/main.js"]
