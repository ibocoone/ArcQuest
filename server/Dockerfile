# Serveur ArcQuest (API). Construire depuis la racine du projet :
#   docker build -f server/Dockerfile -t arcquest-api .
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY server ./server
COPY src/onchain-facts.ts ./src/onchain-facts.ts
ENV API_PORT=3001
EXPOSE 3001
CMD ["bun", "run", "server/index.ts"]
