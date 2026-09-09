# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root manifests
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/bot/package.json ./apps/bot/

# Install dependencies
RUN npm ci

# Copy source files
COPY tsconfig.json ./
COPY packages/shared ./packages/shared
COPY apps/bot ./apps/bot

# Build shared and bot
RUN npm run build -w @username/shared && \
    npm run build -w @username/bot

# Stage 2: Production Runner
FROM node:22-alpine AS runner

RUN apk add --no-cache dumb-init

WORKDIR /app
ENV NODE_ENV=production

# Copy root manifests
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/bot/package.json ./apps/bot/

# Install production dependencies
RUN npm ci --omit=dev

# Copy built code
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/bot/dist ./apps/bot/dist

USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/bot/dist/bot.js"]