# TASKS — backlog des modules patronage, imbrication, confection

Tenu par la session orchestratrice (chef de projet). Les sessions
exécutantes ne modifient pas ce fichier : elles lisent leur tâche dans
`/Users/seritex/Projects/seritex-coordination/taches/<module>.md` et
écrivent dans `rapports/<module>.md`.

**Règle de fin** : une tâche passe à « terminée » seulement si ses tests
passent (commande et résultat cités dans le rapport) **et** que le sous-agent
`revue-qualite` l'a validée. La fusion reste une décision du propriétaire.

**Statuts** : `à faire` · `assignée` · `en cours` · `à relire` · `à corriger` ·
`terminée` · `bloquée` · `décision` (attend le propriétaire)

**Taille** : une demi-journée de travail au plus. Une tâche plus grosse se découpe.

Dernière mise à jour : 2026-11-14

---

## Décisions qui reviennent au propriétaire

| # | Question | Recommandation | Bloque |
|---|---|---|---|
| D-1 | Retirer de `.claude/settings.json` l'autorisation `supabase db push --linked` et mettre en « demander » les fusions et migrations (fait dans cette PR, à valider) | Oui | — |
| D-2 | Le but est-il de remplacer aussi **Modaris** (patronage, Lectra), ou seulement **Diamino** (placement) ? | Diamino d'abord ; Modaris reste en amont, Seritex importe ses DXF | périmètre patronage |
| D-3 | Ajouter une vraie colonne **sens du fil** par pièce (angle du droit-fil), au lieu de le déduire de l'axe principal ? | Oui : migration 0188, montrée avant application | P-02 → P-05, I-02, I-03 |
| D-4 | Relire et fusionner **PR #247** (imbrication phase 4) ; appliquer la migration **0187** avant | — | I-01 puis tout l'imbrication |
| D-5 | Relire et fusionner **PR #246** (confection lot 1) ; appliquer la migration **0186** avant | — | C-07 → C-11 |
| D-6 | Fournir 2 ou 3 **DXF Modaris réels avec ligne de droit-fil** (dont une pièce en biais) | — | P-05, P-07 |
| D-7 | Fournir pour 2 ou 3 articles (t-shirt, polo, chaîne et trame) la **liste des opérations dans l'ordre**, qui dépend de quoi, le type de machine, et l'effectif actuel par opération (plan confection §13) | — | C-08 (données réelles), recette de C-09 |
| D-8 | Simulation d'équipes : quels **critères** comparer en plus des minutes de travail ? (heures sup., 2 postes/jour, machines disponibles, coût) | Minutes de travail, rendement, machines par type, nombre de postes par jour | C-06 |

---

## Transverse

| ID | Tâche | Dépend de | Statut | Critère de fin vérifiable |
|---|---|---|---|---|
| T-01 | Fusion de la PR « organisation multi-agents » (CLAUDE.md, sous-agents, script, TASKS.md) | D-1 | décision | `ls .claude/agents` sur `main` liste les 5 sous-agents ; `scripts/worktree-module.sh` crée un worktree qui les contient |

---

## Patronage (`patronnage` dans le code)

| ID | Tâche | Dépend de | Statut | Critère de fin vérifiable |
|---|---|---|---|---|
| P-01 | Écran bibliothèque : régler par pièce les **rotations autorisées** (0°, 180°, les deux) et la **symétrie** (aucune / paire). Colonnes déjà en base (0182), aucun écran ne les modifie aujourd'hui | T-01 | à faire | Server Action validée par Zod (refuse `{90}`, `{}`, `{0,0}`) ; un utilisateur sans droit d'écriture patronnage est refusé **en base** (scénario `scripts/sql-bench/test-patron-rotations.mjs`) ; `npm run test:sql` et `npm run build` passent ; capture ou description de l'écran dans le rapport |
| P-02 | Migration 0188 : colonne `pattern_pieces.angle_droit_fil` (degrés, `0 ≤ x < 360`), valeur par défaut documentée, sans toucher aux pièces existantes | D-3 | décision | Banc SQL : la colonne existe, la contrainte refuse 360 et −1, les lignes existantes gardent leur valeur ; migration idempotente (rejouée deux fois sans erreur) |
| P-03 | Écran bibliothèque : saisir le sens du fil par pièce, flèche affichée sur l'aperçu de la pièce | P-02 | à faire | La valeur saisie est relue identique après rechargement ; la flèche suit l'angle (0°, 90°, 45°) ; build OK |
| P-04 | Export DXF : écrire la ligne de droit-fil de chaque pièce | P-02 | à faire | `npm run test:patronnage` : un DXF exporté puis relu redonne l'angle à ±0,5° |
| P-05 | Import DXF : lire la ligne de droit-fil des DXF Modaris pour pré-remplir `angle_droit_fil` | P-02, D-6 | bloquée | Sur les DXF fournis (D-6) : angle détecté à ±0,5° ; DXF sans ligne de droit-fil → import inchangé, angle par défaut |
| P-06 | Non-régression de l'import DXF Modaris/Diamino : corpus de DXF réels rejoués dans `test:patronnage` | D-6 | bloquée | `npm run test:patronnage` rejoue chaque DXF du corpus ; nombre de pièces, aires et noms identiques à la référence enregistrée |

---

## Imbrication

| ID | Tâche | Dépend de | Statut | Critère de fin vérifiable |
|---|---|---|---|---|
| I-01 | Phase 4 (PR #247) : plan de coupe déterministe + outils pour agents IA | D-4 | à relire | `revue-qualite` rend VALIDÉE sur la branche `feat/imbrication-phase4` ; `test:imbrication` 69/69, `test:planification` 9/9, `test:sql` OK relancés |
| I-02 | Lire `angle_droit_fil` dans `src/lib/imbrication/patrons.ts` : la pièce est orientée selon son droit-fil, et non plus selon son axe principal | P-02, I-01 | à faire | `npm run test:imbrication` : une pièce à droit-fil 30° est posée à 30° (ou 210° si 180 est autorisé) ; sans `angle_droit_fil`, résultat identique à aujourd'hui sur tout le banc |
| I-03 | Contrôle indépendant (`validation.ts`) : refuser un tracé dont une pièce n'est pas posée selon son droit-fil ± rotations autorisées | I-02 | à faire | Test : tracé truqué avec une pièce tournée de 90° → refus avec un code d'erreur dédié, documenté dans `docs/imbrication.md` |
| I-04 | Phase 5, tests de propriétés : sur les cas du banc, aucune pièce hors laize, aucun chevauchement, rotations respectées, même entrée + même graine = même tracé (`scripts/test-imbrication.ts` n'est pas modifié par la PR #247 : pas de conflit) | T-01 | à faire | Nouveau groupe dans `test:imbrication`, au moins 50 cas tirés au hasard à graine fixe, tous verts ; durée totale < 5 min |
| I-05 | Phase 5, rapport de rendement contre Diamino sur des tracés réels | I-04, D-6 | bloquée | Tableau dans `docs/imbrication.md` : longueur Seritex contre Diamino par cas, écart en %, temps de calcul |
| I-06 | Phase 5 : documentation finale de `docs/imbrication.md` (état, limites, comment ajouter une contrainte) | I-03, I-04 | à faire | Le tableau d'avancement est à jour ; chaque code d'erreur du contrat est documenté ; relu par `revue-qualite` |

---

## Confection

| ID | Tâche | Dépend de | Statut | Critère de fin vérifiable |
|---|---|---|---|---|
| C-01 | Lot 1 (PR #246) : chaînes, ravitaillement par scan, sorties, rendement par chaîne | D-5 | à relire | `revue-qualite` rend VALIDÉE sur `feat/confection-lot1-chaines` ; `scripts/sql-bench/test-confection-chaines.mjs` vert |
| C-02 | Moteur d'équilibrage, socle : types (opération, temps, précédences, type de machine) et calculs de base (cadence visée, effectif théorique minimum, capacité d'un poste, goulot, taux d'équilibre, production journalière théorique). TypeScript pur, sans base : `src/lib/confection/equilibrage.ts` | T-01 | à faire | `npm run test:equilibrage` : au moins 6 cas calculés à la main (dont l'exemple 2 × 480 ÷ 800 = 1,2 min du plan) donnent le résultat exact ; une précédence en boucle est refusée avec un message clair |
| C-03 | Équilibrage : algorithme du poids positionnel classé (précédences, même type de machine pour partager un poste, opération plus longue que la cadence répartie sur plusieurs postes) | C-02 | à faire | `test:equilibrage` : sur 3 cas d'école publiés dont la solution optimale est connue, le nombre de postes trouvé est optimal ; aucune précédence ni contrainte de machine violée (vérifié par une fonction de contrôle indépendante) |
| C-04 | Équilibrage : amélioration locale (échanges entre postes voisins) et les deux modes (« j'ai N personnes → combien de pièces » / « je veux N pièces → combien de personnes ») | C-03 | à faire | `test:equilibrage` : l'amélioration ne dégrade jamais l'équilibre ; production théorique pour 8, 10 et 12 couturiers croissante sur un t-shirt type ; résultat identique sur deux exécutions |
| C-05 | Simulation d'organisation des équipes : scénarios (nombre d'équipes × effectif, minutes de travail, rendement attendu, machines) comparés côte à côte, ex. 2 × 10 contre 1 × 20 | C-04, D-8 | à faire | `test:equilibrage` : la comparaison 2 × 10 / 1 × 20 renvoie pour chaque scénario pièces/jour, goulot, équilibre, personnes en trop ou en moins ; cas d'école vérifié à la main |
| C-06 | Chutes de couture en sacs pesés depuis la tablette de chaîne (décision C18, non faite au lot 1) | C-01 | à faire | Banc SQL : un sac pesé est rattaché à la chaîne et au jour ; il apparaît dans le rendement matière ; un agent d'une autre chaîne ne peut pas le saisir |
| C-07 | Tablette : saisir un comptage différent de l'étiquette à la livraison (`p_comptage` existe déjà côté base) | C-01 | à faire | La tablette propose la correction ; le banc SQL vérifie l'écart enregistré et le parcours du lot ; build OK |
| C-08 | Migration lot 3 : catalogue d'opérations, nomenclature versionnée par article, précédences, temps avec leur source (estimé / chronométré / mesuré), droit `confection_operations`, RLS | C-01 | à faire | Banc SQL `test-confection-operations.mjs` : une version passée reste lisible après modification ; boucle de précédence refusée ; utilisateur sans droit refusé en base ; numéro de migration réservé |
| C-09 | Écran nomenclature d'opérations d'un article (saisie, ordre, précédences, machine, temps, copie depuis un article proche) | C-08 | à faire | Créer, modifier, copier une nomenclature depuis l'écran ; relue identique ; build OK |
| C-10 | Écran équilibrage et simulation branché sur la nomenclature (propose, l'humain valide ; rien n'est appliqué) | C-05, C-09 | à faire | Sur une nomenclature saisie : charges par poste, goulot, production théorique pour 8/10/12 personnes et comparaison de scénarios affichées ; aucune affectation créée sans validation |

---

## Ordre conseillé et parallélisme

- **Tout de suite, sans conflit entre modules** : P-01 (patronage), I-04 (imbrication), C-02 → C-05 (moteur pur, aucune migration), revue I-01 et C-01.
- **Après D-3** : P-02 (migration 0188), puis P-03 / P-04 en parallèle, et I-02 → I-03 côté imbrication.
- **Après D-5** : C-08 (prochaine migration libre), puis C-09, C-10 ; C-06 et C-07 en parallèle.
- Une seule migration à la fois par module ; numéros dans `seritex-coordination/migrations.md`.

## Journal

| Date | Événement |
|---|---|
| 2026-11-14 | Création du backlog après l'audit. Migrations prises : 0186 (PR #246), 0187 (PR #247). Prochain numéro libre : 0188, réservé pour P-02 sous réserve de D-3. |
