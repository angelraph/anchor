FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY docs/img ./docs/img
ENV NODE_ENV=production DATA_DIR=/app/data
EXPOSE 3000
CMD ["node", "--import", "tsx", "src/index.ts"]
