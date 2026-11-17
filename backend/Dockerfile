# One Dockerfile for every service:  docker build --build-arg SERVICE=wallet -t willspot-wallet .
# Build context: the repository root (so brand/brand.json is available to the config service).
# TODO before production: pin base images by digest (docs/SECURITY.md).

FROM node:24-alpine AS build
WORKDIR /src
COPY backend/package.json backend/package-lock.json ./
COPY backend/packages/common/package.json packages/common/
COPY backend/services/gateway/package.json services/gateway/
COPY backend/services/identity/package.json services/identity/
COPY backend/services/wallet/package.json services/wallet/
COPY backend/services/trade/package.json services/trade/
COPY backend/services/config/package.json services/config/
COPY backend/services/giftcards/package.json services/giftcards/
COPY backend/services/bills/package.json services/bills/
COPY backend/services/risk/package.json services/risk/
COPY backend/services/notifications/package.json services/notifications/
RUN npm ci --no-audit --no-fund
COPY backend/ ./
ARG SERVICE
RUN test -n "$SERVICE" && node scripts/build.mjs "$SERVICE"

FROM node:24-alpine AS runtime
ARG SERVICE
ENV NODE_ENV=production \
    BRAND_SEED_FILE=/app/brand/brand.json \
    HOST=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /src/dist/${SERVICE}/ ./
COPY --chown=node:node brand/brand.json ./brand/brand.json
USER node
# 9464 = Prometheus metrics (never routed publicly)
EXPOSE 8080 4001 4002 4003 4004 4005 4006 4007 4008 9464
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-8080}/healthz" >/dev/null || exit 1
CMD ["node", "--enable-source-maps", "bin/server.mjs"]
