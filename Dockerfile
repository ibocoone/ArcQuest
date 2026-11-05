# Serveur ArcQuest (API)
#   docker build -t arcquest-api .
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY server ./server
COPY src/onchain-facts.ts ./src/onchain-facts.ts
EXPOSE 3001
CMD ["bun", "run", "server/index.ts"]
