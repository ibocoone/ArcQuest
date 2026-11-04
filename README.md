# ArcQuest

Plateforme française de micro-tâches et de concours payés en USDC sur Arc Testnet. Les utilisateurs créent un compte par e-mail ou portefeuille, déposent du USDC dans un coffre onchain, publient des tâches, réalisent celles des autres avec une preuve, sont approuvés et payés depuis le portefeuille du créateur, puis retirent leur USDC à tout moment.

Built with [Arc Studio](https://studio.arc.io)

## Fonctionnalités

- Comptes par e-mail et mot de passe, ou par signature de portefeuille. Sessions côté serveur.
- Tâches et concours partagés entre tous les utilisateurs, avec recherche, filtres et pagination.
- Une seule soumission par personne et par tâche, places décomptées, date limite, preuve obligatoire (lien ou capture d'écran), motif en cas de refus.
- Approbation et paiement par le créateur, vérifiés sur la blockchain avant d'être enregistrés.
- Dépôt, retrait et remboursement des fonds non utilisés, historique lu dans le contrat.
- Notifications dans l'application, signalements, espace d'administration (modération, suspension, journal).
- Pages Conditions d'utilisation et Confidentialité (modèles à faire relire par un juriste).

## Stack

React, TypeScript, Vite, Tailwind CSS, wagmi, viem, ConnectKit, TanStack Query. Serveur Bun avec Postgres. Contrat Solidity `contracts/ArcQuestVault.sol`.

## Développement

Prérequis : [Bun](https://bun.sh), Docker (pour Postgres).

```
docker run -d --name postgres --restart unless-stopped -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=earnfi -v pgdata:/var/lib/postgresql -p 5432:5432 postgres:18-alpine
bun install
bun run server      # API sur le port 3001 (crée les tables au démarrage)
bun run dev         # interface sur le port 5173, /api est redirigé vers l'API
bun run test:server # tests de l'API (le serveur doit tourner)
bun run check       # lint + typecheck
bun run build
```

## Variables d'environnement

- `DATABASE_URL` : connexion Postgres.
- `API_PORT` : port de l'API (3001 par défaut).
- `ADMIN_EMAILS`, `ADMIN_WALLETS` : e-mails et adresses (séparés par des virgules) qui obtiennent le rôle administrateur à l'inscription ou à la connexion.
- `COOKIE_SECURE` : `true` en production HTTPS.
- `VITE_VAULT_ADDRESS` : adresse du contrat ArcQuestVault sur Arc Testnet.
- `VITE_VAULT_DEPLOY_BLOCK` : bloc de déploiement du contrat (point de départ de l'historique).
- `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS` : fournies par Arc Studio, facultatives en dehors d'Arc Studio (sinon le RPC public est utilisé).

## Contrat

`contracts/ArcQuestVault.sol` : coffre USDC sans administrateur ni frais. Chaque utilisateur dépose, retire et réserve de l'argent pour une tâche ou un concours. Seul le créateur peut payer les travailleurs depuis sa propre réserve, et la récupérer une fois le délai écoulé.

## Limites actuelles

- Les notifications sont dans l'application uniquement (pas d'e-mails).
- Le parrainage est un compteur : aucune récompense n'est versée.
- Pas de commission de la plateforme.
- Les fichiers de preuve sont stockés sur le disque du serveur.

## Mise en ligne

Le site a deux parties à héberger :

1. **Interface (Vercel).** Importez le projet : Vercel construit l'interface Vite. Le dossier `api/` contient un relais qui envoie `/api/*` vers votre serveur, pour que la session par cookie reste sur le même domaine.
2. **Serveur et base de données.** Le serveur Bun se construit avec `server/Dockerfile` (`docker build -f server/Dockerfile -t arcquest-api .`) et a besoin d'une base Postgres.

Variables du serveur : `DATABASE_URL`, `VITE_VAULT_ADDRESS`, `COOKIE_SECURE=true` (obligatoire en HTTPS), `ADMIN_EMAILS` ou `ADMIN_WALLETS`.

Variable côté Vercel : `API_ORIGIN` = adresse https du serveur, par exemple `https://api.exemple.com` (sans `/api` à la fin).

Variable de l'interface à fournir à la construction : `VITE_VAULT_ADDRESS` et `VITE_VAULT_DEPLOY_BLOCK`.
