# GERetro

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

Le fichier `vercel.json` a la racine du depot configure l'installation, le build et le dossier de sortie de cette application.

## Activer le temps reel avec Supabase

1. Creer un projet sur Supabase.
2. Ouvrir le SQL Editor et executer le contenu de `supabase-schema.sql`.
	Le script est idempotent : le reexecuter applique aussi les migrations aux tables existantes.
3. Ajouter ces variables dans Vercel, dans **Settings > Environment Variables** :

```text
VITE_SUPABASE_URL=https://votre-projet.supabase.co
VITE_SUPABASE_ANON_KEY=votre-cle-anon
```

4. Relancer un redeploiement Vercel.

Sans ces variables, la creation et la validation des seances par QR code sont indisponibles.
