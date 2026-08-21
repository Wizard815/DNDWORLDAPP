# One image: a single Node process serving the API and the built client.
# No native modules, so no build toolchain is needed in either stage.

FROM node:24-bookworm-slim AS build
WORKDIR /app

# Package manifests first, so dependency layers survive source edits.
COPY package.json package-lock.json ./
COPY packages/schema/package.json packages/schema/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY . .
RUN npm run build


FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080 \
    HOST=0.0.0.0
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/schema/package.json packages/schema/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace=@dndworldapp/server --include-workspace-root \
    && npm cache clean --force

COPY packages/schema ./packages/schema
COPY apps/server ./apps/server
COPY --from=build /app/apps/web/dist ./apps/web/dist

# The volume. Everything that matters — database and uploads — lives here,
# so a backup is a copy of this directory.
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]
USER node

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Node 24 runs TypeScript directly, so there is no server build step to go stale.
CMD ["node", "--disable-warning=ExperimentalWarning", "apps/server/src/index.ts"]
