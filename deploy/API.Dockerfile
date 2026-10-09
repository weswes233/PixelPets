# Resolve these tags to reviewed digests before a public release; compose records the selected image.
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server/src ./server/src
COPY chain-client/src ./chain-client/src
COPY chain/idl ./chain/idl
COPY tools/backup.ts ./tools/backup.ts
RUN mkdir -p /app/runtime/backups && chown -R node:node /app/runtime
USER node
EXPOSE 9782
CMD ["node", "server/src/index.ts"]
