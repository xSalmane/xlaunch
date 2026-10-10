# XLaunch — launchpad Base jouable directement dans X

Les gens lancent un token sur Base depuis un tweet ou depuis le site, sans wallet.
Ton backend paie le gas et déploie le token, avec sa pool Uniswap v3, dans la même transaction.

**100 % de la supply part dans la pool**, et la liquidité est verrouillée à vie. Le créateur ne reçoit aucun token. Il touche uniquement **sa part des frais de trading** (50 % par défaut), mise en séquestre sous l'id de son compte X. Il la récupère quand il veut vers l'adresse de son choix, et le gas de la récupération est aussi offert.

## Le site

| Page | Ce qu'on y fait |
|---|---|
| `/` | Lancer un token : nom, ticker, logo, description. Une pièce montre l'aperçu en direct. On y voit aussi les derniers lancements. |
| `/explore` | Tous les tokens, avec recherche et tri (nouveaux, volume 24 h, market cap), mis à jour en continu. |
| `/t/<adresse>` | La fiche d'un token : market cap, prix, variation, volume, graphique, derniers trades, frais gagnés par le créateur, boutons Acheter et Partager. |
| `/me` | Mes gains : total gagné, montant en séquestre, récupération vers une adresse, liste de mes tokens. |
| `/embed` | La version compacte affichée **dans le tweet** (player card X). |

Tweeter `https://ton-domaine/` affiche le lanceur dans le tweet. Tweeter `https://ton-domaine/t/<token>` affiche la fiche du token dans le tweet.

```
Tweet (player card) ─iframe─▶ /embed ─┐
Site (/, /explore, /t, /me) ──────────┼─▶ API Express ──relayer──▶ XLaunchFactory (Base)
                                      │      │   ▲                   ├─ LaunchToken (CREATE2)
                       popup OAuth X ─┘      │   └── indexeur ◀──────┼─ pool Uniswap v3 1 %
                                          SQLite   (swaps)           └─ séquestre par compte X
```

## Contenu

| Fichier | Rôle |
|---|---|
| `contracts/src/XLaunchFactory.sol` | Déploie le token, crée la pool avec liquidité 100 % token, garde la position LP à vie. Répartit les frais et gère le séquestre et les réclamations signées. |
| `contracts/src/LaunchToken.sol` | ERC-20 à supply fixe (1 milliard), sans owner ni mint. |
| `backend/src/server.ts` | Pages et API : lancement, upload de logo, tokens, trades, graphique, gains, réclamation. |
| `backend/src/indexer.ts` | Suit les swaps de chaque pool, ce qui alimente prix, volumes, graphiques et frais gagnés. |
| `backend/src/auth.ts` | Connexion X (OAuth 2.0 PKCE), plus une connexion de démo réservée au local et au testnet. |
| `backend/public/` | Le front : HTML, CSS et JS sans framework ni build. |
| `backend/scripts/local.ts` | Démo locale complète : chaîne, Uniswap, tokens d'exemple et trades simulés. |
| `backend/test/e2e.ts` | Test bout-en-bout des contrats avec le vrai Uniswap v3. |

## Essayer en local (5 minutes, sans X ni vrais fonds)

Il faut Node 20 ou plus et Foundry (pour `anvil`) : `curl -L https://foundry.paradigm.xyz | bash && foundryup`.

```bash
cd contracts && npm install && node compile.mjs
cd ../backend && npm install && npm run sync-abi
npm run local            # puis ouvre http://localhost:8787
```

Le bouton « Se connecter avec X » ouvre alors une connexion de démo : tu choisis juste un pseudo. Des tokens d'exemple sont créés et des trades simulés tournent toutes les 6 secondes. Pour partir d'une base vide, lance `npm run local -- --no-seed`.

Tests des contrats : `npm test`.

## Mise en ligne (Base Sepolia, puis Base)

1. **App X.** Sur developer.x.com, crée une app OAuth 2.0 :
   - type Web App (confidential client) ;
   - callback `https://TON_DOMAINE/auth/x/callback` ;
   - scopes `users.read` et `tweet.read`.
2. **Configuration.** Fais `cp backend/.env.example backend/.env`, puis remplis-le. Il te faut trois clés différentes :
   - le déployeur ;
   - le relayer, qui paie le gas ;
   - l'attester, qui signe les réclamations.
3. **Déploiement.** Lance `npm run deploy` et copie la `FACTORY_ADDRESS` affichée dans `.env`.
4. **Gas.** Envoie de l'ETH sur l'adresse du relayer.
5. **Démarrage.** Lance `NODE_ENV=production npm start` derrière un HTTPS (Caddy, Nginx, Railway, Fly…). Le HTTPS est obligatoire pour les player cards. Garde `uploads/` et la base SQLite sur un disque persistant.
6. **Vérification.** Tweete ton domaine et vérifie que la card s'affiche.

Pour Base mainnet, mets `CHAIN=base` et un RPC mainnet (Alchemy, QuickNode…). La connexion de démo est automatiquement interdite sur mainnet.

## Règles par défaut (modifiables dans `.env`)

- Compte X de plus de 30 jours et au moins 50 followers.
- 1 lancement par compte et par 24 h, et 30 lancements par heure pour tout le site.
- Un ticker ne peut être utilisé qu'une fois, et les mots de `blocklist.txt` sont refusés.
- Logos en PNG, JPG, GIF ou WebP de 1 Mo maximum, hébergés chez toi (format vérifié), 20 par jour et par compte.
- Les lancements se mettent en pause si le relayer passe sous `MIN_RELAYER_BALANCE_ETH`.
- Pour réclamer des gains, il faut s'être connecté avec X depuis moins de 15 minutes.

## Limites connues

- **Affichage dans X.** Sur desktop, la player card devient interactive une fois le tweet ouvert. Sur l'app mobile, elle peut n'afficher que l'image avec un lien vers le site. Le site complet prend alors le relais.
- **Achat des tokens.** Il se fait sur Uniswap, via le bouton Acheter, puisque le site ne connecte pas de wallet.
- **Prix en ETH.** Les prix sont affichés en ETH. Pour un affichage en dollars, il faudra brancher un oracle ETH/USD.
- **Sécurité.**
  - Mets la clé attester dans un KMS.
  - Garde peu d'ETH sur le relayer.
  - Utilise un multisig comme `owner` du contrat.
  - Fais **auditer les contrats** avant d'y faire passer de vrais fonds.
- **Juridique.** Prélever des frais et garder des fonds en séquestre pour des tiers peut relever de MiCA et de l'AMF. Fais valider le modèle par un juriste.
- **Mono-instance.** SQLite et l'état OAuth en mémoire conviennent pour un serveur. Pour plusieurs serveurs, passe à Postgres et Redis.
