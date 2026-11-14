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

---

## Architecture et stack
- **Next.js 16** (App Router, React 19, TypeScript strict). Le middleware
  s'appelle `src/proxy.ts` (→ `src/lib/supabase/proxy.ts`). Logique serveur
  en Server Actions (`actions.ts` à côté de chaque page) et routes
  `src/app/api/**/route.ts` (PDF, étiquettes, exports, routes sans session
  protégées par `CRON_SECRET`).
- **Supabase** (Postgres + Auth + Realtime). Les droits sont vérifiés **en
  base** : RLS sur toutes les tables, matrice des droits (modules
  `src/lib/auth/modules-catalog.ts`), mutations sensibles par fonctions
  `SECURITY DEFINER`. Ne jamais se contenter d'un contrôle dans l'interface.
- **Moteur d'imbrication en Rust** (`rust/imbrication`) compilé en
  WebAssembly `wasm32-wasip1` → `src/lib/imbrication/moteur/seritex-imbrication.wasm`,
  exécuté par Node dans un worker. Voir `docs/imbrication.md`.
- **Vercel** : déploiement automatique à la fusion sur `main`, et seulement là.
- Intégrations : Sage (miroir via le NAS, `src/lib/sage-mirror`), FreeTrack
  / GPSWOX (véhicules), Resend (e-mails), imprimantes Sunmi (`src/lib/print`).

### Arborescence
| Dossier | Contenu |
|---|---|
| `src/app/(app)/<espace>/` | pages par espace (articles, atelier, confection, devis, stock, livraisons, parametres…) |
| `src/lib/<domaine>/` | logique métier pure ou serveur, un dossier par domaine |
| `src/components/<espace>/` | composants React par espace |
| `supabase/migrations/NNNN_nom.sql` | migrations numérotées, commentées en français |
| `scripts/test-*.ts` | tests des moteurs (lancés par `tsx`) |
| `scripts/sql-bench/test-*.mjs` | banc SQL : rejoue toutes les migrations dans PGlite puis teste les scénarios |
| `rust/imbrication/` | moteur d'imbrication (sparrow + jagua-rs) |
| `docs/` | documentation technique d'un module (ex. `docs/imbrication.md`) |

Les plans de chantier (décisions du propriétaire, lots) sont **hors du
dépôt** dans `~/Projects/Seritex-plans/`. Les lire avant de travailler sur un
module qui en a un (ex. `module-confection.md`).

## Conventions
- **Langue** : tout en français : noms métier (tables, colonnes, fonctions
  SQL, fichiers, variables du domaine : `rotations_autorisees`,
  `chaine_travaux`, `mettreEnPageCartouche`), commentaires, interface,
  messages de commit, PR. Les tables historiques en anglais (`quotes`,
  `pattern_pieces`, `article_lots`…) gardent leur nom : ne pas renommer.
- Le module de patronage s'écrit **`patronnage`** dans le code (dossiers,
  routes, script de test). Garder cette graphie pour rester cohérent.
- **Fichiers** : kebab-case (`plan-coupe.ts`) ; composants React en
  PascalCase dans le code ; Server Actions dans `actions.ts`.
- **Validation** des entrées par Zod (`zod` v4), formulaires par
  react-hook-form.
- **Migrations** :
  - numéro sur 4 chiffres, `NNNN_description_courte.sql`, idempotentes
    autant que possible (`if not exists`, `drop … if exists` avant `create`) ;
  - en tête : un commentaire qui explique le pourquoi et ce qui change ;
  - **numéro réservé auprès de l'orchestrateur** (voir « Organisation
    multi-agents ») et revérifié sur `main`, les branches distantes et les
    PR ouvertes juste avant le commit : plusieurs sessions travaillent en
    parallèle et se sont déjà disputé des numéros ;
  - toute nouvelle table : RLS activée + politiques + entrée dans la
    matrice des droits si elle relève d'un module ;
  - compatible `pg_safeupdate` : jamais d'`UPDATE`/`DELETE` sans `WHERE`.
- **Commits** : message en français, première ligne `Module : ce qui change`
  (ex. `Imbrication phase 3 : calcul du tracé depuis la fenêtre du tracé`),
  puis le pourquoi. Une PR par lot ou par tâche cohérente.
- **Branches** : `feat/<module>-<sujet>`, `fix/<sujet>`, `chore/<sujet>`,
  toujours parties de `main` à jour.

## Commandes
```bash
npm run dev                 # serveur local (copie d'abord pdf.js)
npm run build               # build de production : doit passer avant toute PR
npm run typecheck           # tsc --noEmit
npx eslint <fichiers>       # lint (scripts/ est exclu de la config)
npm run test:sql            # banc SQL complet (toutes les migrations + scénarios)
npm run test:patronnage     # moteur de patronage
npm run test:imbrication    # moteur d'imbrication (contrat, validation, cas du banc)
npm run test:planification  # plan de coupe (après fusion de la phase 4)
npm run test:<autre>        # pricing, livraison, separation, vehicules… (voir package.json)
# Moteur Rust (voir docs/imbrication.md pour l'installation de la cible WASM)
cd rust/imbrication && cargo test
```
Il n'y a **pas d'intégration continue** sur GitHub : ces contrôles sont
lancés à la main, dans l'ordre de la section « Vérifie avant de commiter ».

## Règles métier

### Patronage (`patronnage`)
- Bibliothèque de patrons, import et export DXF (`dxf-parser`,
  `src/lib/patronnage/dxf-export.ts`), cartouche, fiches de placement,
  tracés, ordres de tracé, besoins de coupe.
- **Sens du fil et rotations autorisées se paramètrent par pièce dans la
  bibliothèque de patrons.** Rotations : `pattern_pieces.rotations_autorisees`,
  `{0,180}` par défaut, seules valeurs admises 0 et 180 ; `symetrie` =
  `aucune` ou `paire`. Le sens du fil n'a pas encore de colonne à lui : il
  est déduit de l'axe principal de la pièce (voir `TASKS.md`).
- Un tracé fait dans Modaris / Diamino et déposé en DXF doit toujours rester
  utilisable : le calcul Seritex est une voie de plus, jamais une obligation.

### Imbrication
- Placement automatique des pièces sur la laize pour la plus petite longueur
  de tissu, **en respectant le sens du fil et les rotations autorisées de
  chaque pièce**.
- **Choix du moteur fait et en production** : sparrow 0.3.0 (MIT) sur
  jagua-rs 1.0.0 (MPL-2.0, utilisé sans modification), compilés dans Seritex.
  Écartés : Deepnest (cœur `deepnest.js` sous GPLv3 selon deepnest-next, et
  aucune licence déclarée dans le dépôt d'origine : incompatible avec un code
  propriétaire), SVGnest (MIT, mais algorithme génétique plus ancien, peu
  maintenu, en retrait sur sparrow). Toute nouvelle
  dépendance de moteur : licence vérifiée et notée dans `docs/imbrication.md`.
- **L'IA ne dessine pas les tracés** : le moteur déterministe calcule, un
  contrôle indépendant (`src/lib/imbrication/validation.ts`) vérifie chaque
  tracé, et un humain valide. Aucun outil d'agent ne transforme un calcul en
  fichier de tracé ni ne valide une coupe.
- Contrat JSON `seritex.imbrication/v1` : toute évolution est versionnée.

### Confection
- **Nomenclature des opérations par article** (ex. t-shirt) : liste
  ordonnée avec **ordre de précédence**, type de machine et **temps
  chronométrés en interne**. Un article sans temps ne bloque rien ; chaque
  temps porte sa source (estimé / chronométré / mesuré).
- **Équilibrage de chaîne** : répartition optimale des opérations sur les
  postes et production journalière théorique selon l'effectif (8, 10,
  12 couturiers…). Méthode retenue : poids positionnel classé, déterministe
  et explicable (charge de chaque poste, goulot, taux d'équilibre).
- **Simulation d'organisation des équipes** : comparer des scénarios (ex.
  2 équipes de 10 contre 1 équipe de 20) selon le temps de travail, les
  machines disponibles et les autres critères ; résultat côte à côte.
- **Suivi de production atelier** : semi-finis entrants (paquets QR livrés
  aux chaînes), transformés, produits finis sortants (sortie de chaîne =
  déclaration au moteur d'ODF).
- Le logiciel **propose, un humain valide** : aucune répartition n'est
  appliquée, aucun temps n'atteint le prix de revient sans validation.
- Plan et décisions C1-C24 : `~/Projects/Seritex-plans/module-confection.md`.

## Règles de sécurité
- **Jamais de déploiement en production ni de push sur `main`.** Seul le
  propriétaire fusionne, après relecture (voir plus haut).
- **Jamais de suppression de données ni de migrations existantes** sans
  l'accord explicite du propriétaire. Une migration déjà écrite ne se
  modifie pas : on en ajoute une nouvelle (sauf renumérotation d'une
  migration jamais appliquée, signalée dans la PR).
- **Jamais d'application de migration** (`supabase db push`, SQL sur la base
  de production) par Claude : la migration est montrée dans la PR, le
  propriétaire l'applique.
- **Aucun secret dans le code** (clés, mots de passe, jetons, URL signées) :
  variables d'environnement uniquement (`process.env.X`), côté serveur sauf
  les clés publiques `NEXT_PUBLIC_*`. Aucun fichier `.env*` dans un commit.
  Un secret aperçu dans une sortie de commande n'est jamais recopié.

## Organisation multi-agents
- **Orchestrateur** : une session Claude Code « chef de projet » tient
  `TASKS.md`, assigne les tâches et fait relire. Elle ne code pas les modules.
- **Dossier de coordination hors du dépôt** :
  `/Users/seritex/Projects/seritex-coordination/`
  - `taches/<module>.md` : écrit par l'orchestrateur seul (tâches assignées) ;
  - `rapports/<module>.md` : écrit par la session exécutante du module seule ;
  - `migrations.md` : réservation des numéros de migration, tenue par
    l'orchestrateur.
- **Sessions exécutantes** : une par module, dans son propre worktree
  (`scripts/worktree-module.sh`). Elles ne modifient **que leur worktree** et
  leur fichier de rapport, ne touchent ni `TASKS.md` ni `taches/`.
- **Sous-agents** (`.claude/agents/`) : `dev-patronage`, `dev-imbrication`,
  `dev-confection` (chacun limité à son module et ses tests), `testeur`
  (écrit et lance les tests), `revue-qualite` (relit sans écrire de
  fonctionnalité).
- **Fichiers partagés** entre modules (`src/lib/auth/modules-catalog.ts`,
  `src/lib/auth/nav.ts`, `src/lib/supabase/proxy.ts`, `package.json`,
  `supabase/migrations/`) : ajouts minimaux, signalés dans le rapport.
  Modifier le code d'un **autre** module est interdit : le signaler comme
  blocage dans le rapport.
- **Une tâche n'est terminée que si** ses tests passent (commande et
  résultat cités dans le rapport) **et** que `revue-qualite` l'a validée.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
