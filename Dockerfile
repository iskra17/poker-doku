# Poker Doku — Fly.io 배포 이미지 (Next 커스텀 서버 + Socket.io)
# 빌드는 Fly 원격 빌더에서 수행 (로컬 Docker 불필요): fly deploy

FROM node:22.17-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build \
  && rm -rf .next/cache \
  && npm prune --omit=dev

FROM node:22.17-slim
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json /app/next.config.ts /app/tsconfig.json ./
EXPOSE 3000
# npm 래퍼 없이 tsx 직접 실행 — 종료 시그널이 프로세스에 바로 전달되게
CMD ["node_modules/.bin/tsx", "src/server/index.ts"]
