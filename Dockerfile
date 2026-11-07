# ArcQuest : le site et son API dans un seul service.
#   docker build -t arcquest .
# Le dossier web (interface déjà construite) est inclus dans le dépôt : lancez `bunx vite build --outDir web --emptyOutDir` avant de l'envoyer.
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY server ./server
COPY src/onchain-facts.ts ./src/onchain-facts.ts
COPY web ./web
EXPOSE 3001
CMD ["bun", "run", "server/index.ts"]
