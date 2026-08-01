FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Build client + SSR bundles
RUN bun run build

# Production runtime
FROM oven/bun:1-slim
WORKDIR /app

COPY --from=base /app/dist ./dist
COPY --from=base /app/server.ts ./
COPY --from=base /app/signal/protocol.ts ./signal/protocol.ts
COPY --from=base /app/package.json ./
COPY --from=base /app/node_modules ./node_modules

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["bun", "run", "server.ts"]
