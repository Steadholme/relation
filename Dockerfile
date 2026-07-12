# syntax=docker/dockerfile:1

FROM node:24.18.0-alpine3.23

WORKDIR /app

COPY --chown=node:node package.json server.mjs index.html styles.css manifest.webmanifest ./
COPY --chown=node:node src ./src
COPY --chown=node:node assets ./assets
COPY --chown=node:node vendor ./vendor

ENV NODE_ENV=production \
    PORT=8080

USER node

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD ["node", "server.mjs", "--healthcheck"]

ENTRYPOINT ["node", "server.mjs"]
