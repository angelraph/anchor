FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
ENV NODE_ENV=production DATA_DIR=/app/data
EXPOSE 3000
CMD ["npx", "tsx", "src/index.ts"]
