# XLaunch — image de production (Railway)
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/package.json backend/package-lock.json backend/
RUN cd backend && npm ci
COPY contracts/out contracts/out
COPY backend backend
WORKDIR /app/backend
ENV NODE_ENV=production DATA_DIR=/data
CMD ["npx", "tsx", "src/boot.ts"]
