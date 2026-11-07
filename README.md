# ArcQuest

A micro-task and contest platform paid in USDC on Arc Testnet. Users sign up with an email or a wallet, deposit USDC into an onchain vault, publish tasks, complete other people's tasks with proof, get approved and paid from the creator's wallet, and withdraw their USDC at any time.

Built with [Arc Studio](https://studio.arc.io)

## Features

- Accounts with email and password, or with a wallet signature. Server-side sessions.
- Tasks and contests shared between all users, with search, filters and pagination.
- One submission per person per task, places counted down, deadline, required proof (link or screenshot), reason given for any rejection.
- Approval and payment by the creator, verified on the blockchain before being recorded.
- Deposit, withdrawal and recovery of unused funds; wallet history recorded by the server after verifying each transaction onchain.
- In-app notifications, reports, and an admin area (finances, moderation, accounts, payments, action log).
- Terms of Use and Privacy Policy pages (templates to be reviewed by a lawyer).

## Tech stack

React, TypeScript, Vite, Tailwind CSS, wagmi, viem, ConnectKit, TanStack Query. Bun server with Postgres. Solidity contract `contracts/ArcQuestVault.sol`.

## Development

Prerequisites: [Bun](https://bun.sh) and Docker (for Postgres).

```
docker run -d --name postgres --restart unless-stopped -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=earnfi -v pgdata:/var/lib/postgresql -p 5432:5432 postgres:18-alpine
bun install
bun run server      # API on port 3001 (creates the tables on startup)
bun run dev         # app on port 5173, /api is proxied to the API
bun run test:server # API tests (the server must be running)
bun run check       # lint + typecheck
bunx vite build --outDir web --emptyOutDir   # production build of the app
```

## Environment variables

- `DATABASE_URL`: Postgres connection string.
- `API_PORT`: API port (3001 by default; `PORT` takes precedence when set by the host).
- `ADMIN_EMAILS`, `ADMIN_WALLETS`: comma-separated emails and wallet addresses that get the administrator role.
- `COOKIE_SECURE`: `true` in production over HTTPS.
- `VITE_VAULT_ADDRESS`: address of the ArcQuestVault contract on Arc Testnet.
- `VITE_VAULT_DEPLOY_BLOCK`: deployment block of the contract.
- `RPC_URL_Arc_Testnet`: optional RPC provider URL used by the server for its onchain checks. Never put it in a `VITE_` variable.
- `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS`: provided by Arc Studio, optional elsewhere (the public RPC is used otherwise).

## Contract

`contracts/ArcQuestVault.sol`: a USDC vault with no administrator and no fees. Each user deposits, withdraws and reserves money for a task or contest. Only the creator can pay workers out of the money they reserved, and can recover what is left after the lock delay.

## Current limits

- Notifications are in-app only (no emails).
- Referrals are a counter: no reward is paid.
- No platform fee.
- Wallet history only includes operations made after the history feature was added.

## Tests

`bun run test:server` runs the API tests (accounts, anti-cheating rules, proof files, moderation, administration) and checks that every screen receives all the fields it expects. It needs the server running (`bun run server`).

The full flow with real transactions on Arc Testnet (deposit, task, submission, payment, withdrawal, contest) runs with `E2E_KEYS=/path/keys.json bun run test:server`, where the file holds two throwaway wallet keys `{"creator": "0x…", "worker": "0x…"}`, the first one funded with test USDC. Never use a key that holds real value.

## Deployment

Two free services are enough:

1. **Database (Neon).** A Postgres database. The server creates its tables on startup.
2. **Site and server (Render).** A single service, described by `render.yaml` and built from the `Dockerfile`: it serves the app (the `web` folder) and the API (`/api/*`) at the same address, so the session cookie stays on the same site.

Before pushing an interface change to GitHub, rebuild the app with `bunx vite build --outDir web --emptyOutDir`: the `web` folder is part of the repository and Render copies it as is.

Render service variables: `DATABASE_URL` (Neon address), `ADMIN_WALLETS` or `ADMIN_EMAILS`, `COOKIE_SECURE=true`, `VITE_VAULT_ADDRESS` (already in `render.yaml`).

On the free plan, Render puts the service to sleep after a while without traffic: the next request is slower.
