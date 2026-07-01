# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS deps
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nuxt \
    && mkdir -p /app/data \
    && chown -R nuxt:nodejs /app

COPY --from=build --chown=nuxt:nodejs /app/.output ./.output
COPY --chown=nuxt:nodejs config.yaml ./config.yaml

VOLUME ["/app/data"]
EXPOSE 3000

USER nuxt

CMD ["node", ".output/server/index.mjs"]
