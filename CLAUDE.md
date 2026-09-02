# Instructions pour Claude Code — dépôt Seritex

## Contexte du projet
Seritex est une plateforme de gestion de production pour une entreprise de
confection textile. Dépôt : `Aify-pro/Seritex` (Next.js / Supabase / Vercel).
Principe non négociable du projet : aucune sortie financièrement ou
opérationnellement engageante sans validation humaine — cette même logique
s'applique à ton propre workflow Git : rien ne part en production sans mon
accord explicite.

## Ce que tu dois faire quand je te partage des fichiers à intégrer

1. **Lis les fichiers que je dépose** (dossier que je t'indique au moment
   voulu, ou glissés dans la conversation) et comprends ce qu'ils changent
   par rapport à l'état actuel du dépôt.
2. **Crée une branche depuis `main` à jour** (jamais de commit direct sur
   `main`) : `git checkout main && git pull && git checkout -b <nom-de-branche-descriptif>`.
3. **Intègre les changements** dans l'arborescence du dépôt (ne te contente
   pas de copier les fichiers tels quels si leur structure ou leurs imports
   ne correspondent pas à l'existant — adapte-les proprement).
4. **Vérifie avant de commiter**, dans cet ordre, et corrige si besoin :
   - `npx tsc --noEmit` (typecheck)
   - `npx eslint <fichiers modifiés>` (lint)
   - tests concernés s'il en existe (ex. `npm run test:patronnage`)
   - `npm run build` (le build doit passer, c'est non négociable)
5. **Commite avec un message clair en français** : ce qui change et
   pourquoi, pas seulement quoi.
6. **Pousse la branche** sur GitHub (`git push -u origin <nom-de-branche>`)
   et **ouvre une pull request** vers `main` (`gh pr create` si le CLI
   GitHub est disponible, sinon donne-moi le lien à créer).
7. **Arrête-toi là et attends ma confirmation.** Ne fusionne jamais la PR
   toi-même, même si tout est vert (typecheck, lint, build, tests). Le
   déploiement Vercel se déclenche automatiquement dès que la PR est
   fusionnée sur `main` — c'est cette fusion qui doit rester une décision
   humaine explicite, jamais automatique.

## Ce que tu ne dois jamais faire
- Ne jamais pousser ni committer directement sur `main`.
- Ne jamais fusionner une pull request sans mon accord explicite, même
  si tous les contrôles automatiques passent.
- Ne jamais utiliser un outil de déploiement Vercel qui envoie des fichiers
  hors du flux Git (`vercel deploy` en local, déploiement par upload direct) :
  tout doit transiter par un commit sur une branche, tracé dans l'historique.
- Ne jamais appliquer de migration Supabase automatiquement sans me la
  montrer et me la faire valider d'abord, même si elle semble anodine.
- Ne jamais résoudre un conflit de merge en écrasant silencieusement l'un
  des deux côtés — signale-le moi si le résultat n'est pas évident.

## Une fois que j'ai validé la fusion
Si je te dis de fusionner (ex. "fusionne la PR", "c'est bon, merge") :
1. Fusionne la pull request (`gh pr merge --merge` ou équivalent).
2. Vérifie que le build Vercel se déclenche et attends son état `READY`.
3. Donne-moi l'URL de production et un résumé en une phrase de ce qui a
   changé pour l'utilisateur final.
4. Si le build échoue, ne retente rien seul : montre-moi les logs d'erreur.

## Hygiène du dépôt
- Avant tout `git add`, vérifie qu'aucun fichier temporaire (`*.bundle`,
  `*.patch`, dossiers `patches/` ou `patbun/`) ne se glisse dans le commit.
  Ajoute-les au `.gitignore` si tu les repères non suivis.
- Si `git status` révèle des changements que tu n'as pas toi-même produits
  (travail en cours de quelqu'un d'autre), ne les touche pas — signale-les
  moi avant de continuer.
