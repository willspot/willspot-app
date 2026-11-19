# Admin dashboard (Next.js standalone server with the BFF routes).
# Build context: repository root.   docker build -f web/admin/Dockerfile -t willspot-admin .
# TODO before production: pin base images by digest (docs/SECURITY.md).
FROM node:24-alpine AS build
WORKDIR /src
COPY brand/ brand/
COPY web/package.json web/package-lock.json web/
COPY web/site/package.json web/site/
COPY web/admin/package.json web/admin/
RUN cd web && npm ci --no-audit --no-fund
COPY web/ web/
RUN cd web && npm run build -w admin

FROM node:24-alpine AS runtime
# The services run plain `node`; npm, yarn and corepack aren't needed at runtime and the
# copies bundled in the base image carry their own CVEs (found by Trivy in CI). Remove them.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production PORT=3001 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /src/web/admin/.next/standalone/ ./
COPY --from=build --chown=node:node /src/web/admin/.next/static ./admin/.next/static
COPY --from=build --chown=node:node /src/web/admin/public ./admin/public
USER node
EXPOSE 3001
CMD ["node", "admin/server.js"]
