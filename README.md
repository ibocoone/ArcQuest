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

## Tests

`bun run test:server` lance les tests de l'API (comptes, anti-triche, preuves, modération, administration) et vérifie que chaque écran reçoit tous les champs qu'il attend. Le serveur doit tourner (`bun run server`).

Le parcours complet avec de vraies transactions sur Arc Testnet (dépôt, tâche, soumission, paiement, retrait, concours) s'active avec `E2E_KEYS=/chemin/cles.json bun run test:server`, où le fichier contient deux clés de portefeuilles jetables `{"creator": "0x…", "worker": "0x…"}`, la première financée en USDC de test. N'utilisez jamais une clé qui détient de la valeur réelle.

## Mise en ligne

Trois services, tous avec une offre gratuite :

1. **Base de données (Neon).** Une base Postgres. Le serveur crée ses tables au démarrage.
2. **Serveur (Render).** Construit avec le `Dockerfile` à la racine, décrit par `render.yaml`. Variables : `DATABASE_URL` (adresse Neon), `ADMIN_WALLETS` ou `ADMIN_EMAILS`, `COOKIE_SECURE=true`, `VITE_VAULT_ADDRESS`.
3. **Interface (Netlify).** Construite par `netlify.toml` (`npx vite build`, dossier `dist`). Variables de construction : `VITE_VAULT_ADDRESS` et `VITE_VAULT_DEPLOY_BLOCK`. Une règle de redirection envoie `/api/*` vers le serveur Render, pour que la session par cookie reste sur le même domaine.

Sur l'offre gratuite, le serveur Render se met en veille après un moment d'inactivité : la première requête suivante est plus lente.
