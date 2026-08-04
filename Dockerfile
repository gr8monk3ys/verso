# Two stages: build with dev deps, run with production deps only.
# The runtime layout mirrors ops/verso.service.example — WorkingDirectory
# /srv/verso is load-bearing (schema.sql is resolved relative to it at boot),
# and the entry point is `next start` directly, without npm in the way.
FROM node:24-alpine AS build
WORKDIR /srv/verso
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# `next start` loads next.config.ts at runtime and needs typescript to do it,
# so it survives the prune — pinned to the version the repo already declares.
RUN npm run build && npm prune --omit=dev \
    && npm install --no-save --ignore-scripts \
       typescript@"$(node -p "require('./package.json').devDependencies.typescript")"

FROM node:24-alpine
ENV NODE_ENV=production \
    VERSO_DB_PATH=/var/lib/verso/verso.db \
    VERSO_MEDIA_DIR=/var/lib/verso/media
WORKDIR /srv/verso
COPY --from=build /srv/verso ./
# The unit's ReadWritePaths, translated: the process may write the data
# volume and Next's runtime cache, nothing else it doesn't already own.
RUN mkdir -p /var/lib/verso && chown -R node:node /var/lib/verso /srv/verso/.next
USER node
EXPOSE 3000
VOLUME /var/lib/verso
CMD ["node", "node_modules/.bin/next", "start", "--port", "3000"]
