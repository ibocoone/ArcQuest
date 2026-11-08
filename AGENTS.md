# [App Name]

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

[Brief description of what the app does and its primary use case]

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```

## Contrat déployé
- ArcQuestVault (Arc Testnet) : 0xf0848d4325a1cbf85f4c1539194a61036df09b64, variable VITE_VAULT_ADDRESS

## Backend
- API Bun: server/ (port 3001, proxifiée par Vite sur /api). Postgres: conteneur docker "postgres", base earnfi, volume pgdata.
- Démarrer: docker start postgres; bun run server; bun run dev.
- Tests API: bun run test:server (12 tests).
- Comptes administrateur: renseigner ADMIN_EMAILS / ADMIN_WALLETS dans .env puis se (re)connecter.
- Les paiements (approbation, financement) sont vérifiés côté serveur via les événements du contrat.
