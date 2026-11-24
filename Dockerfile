# Anchor: the Telegram bot, the website and the mini app in one process.
# Works on any container host (Northflank, Koyeb, Render, a VPS). Set the
# variables from .env.example on the host; for hosts whose disk is wiped on
# restart, set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN too.
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/app/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY docs/img ./docs/img

# The web server listens here; point the host's public HTTP port at it.
ENV PORT=3000
EXPOSE 3000

# Don't run as root (the state file's folder must stay writable).
RUN mkdir -p /app/data && chown -R node:node /app
USER node

CMD ["node", "--import", "tsx", "src/index.ts"]
