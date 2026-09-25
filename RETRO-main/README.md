# Retro Planner Replica

Interface React/TypeScript construite avec Vite, prete a etre versionnee dans Git et deployee sur Vercel.

## Developpement local

```bash
npm install
npm run dev
```

## Verification et build

```bash
npm run lint
npm run build
```

## Deploiement Vercel

Dans Vercel, importer le depot Git puis conserver les valeurs suivantes :

- Framework preset : `Vite`
- Build command : `npm run build`
- Output directory : `dist`
- Install command : `npm install`

Aucune configuration `vercel.json` n'est necessaire pour cette application frontend statique.

## Activer le temps reel avec Supabase

1. Creer un projet sur Supabase.
2. Ouvrir le SQL Editor et executer le contenu de `supabase-schema.sql`.
3. Ajouter ces variables dans Vercel, dans **Settings > Environment Variables** :

```text
VITE_SUPABASE_URL=https://votre-projet.supabase.co
VITE_SUPABASE_ANON_KEY=votre-cle-anon
```

4. Relancer un redeploiement Vercel.

Sans ces variables, l'application fonctionne en mode local. Avec elles, les tickets crees et deplaces sont synchronises entre les fenetres ouvertes sur la meme session.
