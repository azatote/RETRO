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
