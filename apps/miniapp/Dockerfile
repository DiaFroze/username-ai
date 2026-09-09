# Stage 1: Build Vite SPA
FROM node:22-alpine AS builder

WORKDIR /app

# Accept build arguments for Vite
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/miniapp/package.json ./apps/miniapp/

RUN npm ci

COPY tsconfig*.json ./
COPY packages/shared ./packages/shared
COPY apps/miniapp ./apps/miniapp

RUN npm run build -w @username/shared && \
    npm run build -w @username/miniapp

# Stage 2: Serve via Nginx
FROM nginx:alpine AS runner

ENV PORT=80
ENV NGINX_ENVSUBST_FILTER=PORT

COPY --from=builder /app/apps/miniapp/dist /usr/share/nginx/html
COPY apps/miniapp/default.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:${PORT}/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]