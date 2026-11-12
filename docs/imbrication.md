# Module d'imbrication (tracé de coupe automatique)

Calcule automatiquement le placement des pièces d'un patron sur le tissu
(tracé de coupe), pour la plus petite longueur de tissu possible.

**Ce module est une voie de plus, jamais une obligation.** Un tracé fait
dans Modaris / Diamino et déposé en DXF reste traité exactement comme
aujourd'hui (reconnaissance, contrôle, étiquettes, bon pour coupe). Le tracé
calculé par Seritex aboutira au même objet « tracé » de la fiche de
placement, avec les mêmes contrôles et la même validation humaine.

Principe : **l'IA ne dessine pas les tracés.** Un moteur déterministe calcule ;
les personnes, et plus tard des agents IA, lancent des calculs, comparent
et valident.

## État d'avancement

| Phase | Contenu | État |
|---|---|---|
| 1 | Moteur Rust intégré, contrat JSON, validation indépendante, banc d'essai | **fait** (PR #239) |
| 2 | Pièces lues depuis la bibliothèque, modèle de données (rotations, paires), calculs en arrière-plan par tranches, stockage | **fait** |
| 3 | Aperçu SVG, exports DXF/PDF, interface | à faire |
| 4 | Outils pour agents IA, journal, validation humaine, droits | à faire |
| 5 | Tests complets, documentation finale, rapport | à faire |

## Architecture

```
Seritex (Next.js, TypeScript)
  src/lib/imbrication/contrat.ts     contrat JSON v1 (Zod)
  src/lib/imbrication/validation.ts  contrôle indépendant du tracé
  src/lib/imbrication/moteur.ts      exécute le moteur dans un thread (worker)
        │  entree.json / sortie.json (dossier temporaire)
        ▼
  src/lib/imbrication/moteur/seritex-imbrication.wasm   ← compilé depuis
  rust/imbrication (Rust)  →  sparrow 0.3.0 (MIT)  →  jagua-rs 1.0.0 (MPL-2.0)
```

- **Tout est dans Seritex.** Le moteur est écrit en Rust (`rust/imbrication`)
  et compilé en WebAssembly (cible `wasm32-wasip1`). Node l'exécute avec son
  module WASI standard : pas de service externe, pas de binaire à installer.
  Le même fichier tourne sur Vercel aujourd'hui et sur un serveur Seritex
  demain, sans changement.
- **Le `.wasm` est commité** (comme `src/lib/separation/reveal-core.js`) :
  le déploiement n'a pas besoin de Rust. On ne le reconstruit qu'après une
  modification du code Rust (`npm run build:imbrication`).
- **Le calcul tourne dans un thread séparé** : un tracé de plusieurs minutes
  ne bloque jamais le serveur.
- **Le moteur n'est pas réécrit** : sparrow et jagua-rs sont utilisés tels
  quels (dépendances figées). Notre code Rust se limite au contrat, à la
  conversion des coordonnées et à la règle d'arrêt.
- **Seritex ne croit pas le moteur sur parole** : chaque tracé est recontrôlé
  (`validation.ts`) avant de pouvoir être enregistré comme valide.

### Performances constatées

Le WebAssembly n'utilise qu'un cœur de processeur. Sur le même budget de
temps, il obtient environ 0,3 point d'utilisation de moins que le moteur
natif multi-cœur (exemple : 86,13 % contre 86,40 % en 20 s). Sur un serveur
Seritex, le même code Rust pourra être compilé en natif si ce gain compte.

## Phase 2 : des patrons au calcul en arrière-plan

```
creerCalculImbrication(parametres)        src/lib/imbrication/calculs.ts
  │  demandes : semi-fini × taille × nombre de pièces par couche ; tissu ; temps
  ├─ chargerPatrons + construireEntree     src/lib/imbrication/patrons.ts
  │     relit le DXF de référence de chaque patron, y retrouve la pièce,
  │     convertit en mm, applique rotations et paires
  ├─ insert imbrication_calculs (« en attente », entrée figée)
  └─ after() → GET /api/imbrication/traiter ──┐   (+ pg_cron chaque minute)
                                               ▼
traiterCalculs → prendre_calcul_imbrication()  src/lib/imbrication/execution.ts
  └─ executerTranche : moteur (worker) ≤ 240 s, signe de vie + annulation,
     contrôle indépendant ; reste du temps → « en attente » (reprise du
     meilleur tracé à la tranche suivante), sinon « terminé »
```

### Pièces : relues dans le DXF de référence

La bibliothèque garde les contours **recentrés et tournés** sur leur axe
principal, pour la reconnaissance : l'orientation d'origine, et donc le
droit-fil, n'y est plus. Le calcul relit donc le DXF de référence du patron
et y retrouve la pièce, au point près une fois normalisée de la même façon.
Constaté sur les gabarits Modaris réels (AAMA/ASTM, AC1009) :

- une pièce = un bloc ; ligne de coupe sur le calque 1 en morceaux ouverts
  (réassemblés), couture sur le calque 14, crans sur le calque 11 ;
- pas de ligne de droit-fil exportée, mais **droit-fil selon X** (corps
  742 mm en X, manche 222 mm en X = sa longueur) : d'où les rotations
  {0, 180} par défaut ;
- courbes déjà découpées en segments ; unité 0,1 mm.

Nettoyage avant calcul : points en double (moins de 0,05 mm) et points
alignés (moins de 0,01 mm) retirés. Constaté sur le corps arrière XL réel,
dessiné en deux moitiés : à la jonction, un point à 0,018 mm du premier
formait un « nœud papillon » que le contrôle refusait.

Refus explicites, jamais d'approximation silencieuse : fichier contenant des
arcs (« bulges »), semi-fini tubulaire seulement (pièce au pli), pièce
introuvable dans son fichier (fichier remplacé), taille sans patron, paire
en nombre impair.

### Modèle de données (migration 0182)

- `pattern_pieces.rotations_autorisees` (défaut `{0,180}`) et
  `pattern_pieces.symetrie` (`aucune` | `paire` : moitié des exemplaires
  posée retournée). Rien à saisir par défaut.
- `imbrication_calculs` : paramètres demandés, **entrée figée** (le calcul ne
  dépend plus de la bibliothèque ensuite), correspondance des pièces, statut
  (`en_attente`, `en_cours`, `termine`, `echec`, `annule`), meilleur tracé,
  contrôle, longueur, taux, temps consommé, tranches, auteur (et agent,
  phase 4). Contrainte : **« terminé » exige un tracé validé**.
- Écriture : création par la personne (RLS, droit
  `patronnage_traces.create`, en son nom, sans résultat) ; annulation par
  `annuler_calcul_imbrication` ; résultats par le serveur seulement.
- `prendre_calcul_imbrication` (serveur) : réserve le plus ancien calcul ;
  reprend un calcul resté muet (serveur arrêté en route) depuis son meilleur
  tracé ; après 3 reprises, échec explicite.
- Tâche pg_cron `imbrication-traiter` (chaque minute s'il y a du travail),
  même secret que les notifications (`CRON_SECRET` / Vault
  `notifications_secret`).

### Tranches et durée

Une fonction Vercel dure 300 s au plus : chaque passage exécute une tranche
de 240 s au plus (`IMBRICATION_TRANCHE_S`), qui **repart du meilleur tracé**
de la précédente (champ `reprise` du contrat, ajout compatible en v1). Un
calcul de 10 minutes fait donc 3 tranches. Sur un serveur Seritex sans limite
de durée, régler `IMBRICATION_TRANCHE_S` au temps maximal : une tranche suffit.
Un calcul à budget d'effort (reproductible) tient toujours en une tranche.

Une tranche ratée ne fait jamais perdre le tracé valide déjà trouvé. Un
tracé refusé par le contrôle n'est jamais retenu.

### Moteur natif sur un serveur Seritex

Avec `IMBRICATION_BINAIRE=/chemin/seritex-imbrication`, Seritex lance le
même moteur compilé pour la machine (`cargo build --release` dans
`rust/imbrication`) au lieu du WebAssembly : même contrat, même contrôle,
même tracé à graine et effort égaux (vérifié), mais plusieurs cœurs. Sur
Vercel, ne rien régler : le WebAssembly est utilisé.

### Face-à-face sur un cas réel (2026-11-12)

Ordre OT-2026-0010-T1 : 48 pièces (t-shirt TSM01, corps avant, corps
arrière, manches, tailles L, XL, XXL), tissu ouvert, laize 167 cm, sans
espacement. Diamino : 854,6 cm (longueur déclarée dans Seritex).

| Moteur Seritex | Temps | Longueur | Utilisation | Écart vs Diamino |
|---|---:|---:|---:|---:|
| WebAssembly (1 cœur, comme sur Vercel) | 30 s | 878,4 cm | 83,7 % | +2,8 % |
| WebAssembly | 2 min | 872,4 cm | 84,3 % | +2,1 % |
| WebAssembly | 10 min | 865,5 cm | 85,0 % | +1,3 % |
| **Natif (multi-cœur, Mac de développement)** | **10 min** | **849,3 cm** | **86,6 %** | **−0,6 %** |

Tous ces tracés passent le contrôle indépendant. Un seul cas réel ne suffit
pas à trancher : le banc d'essai sur 10 à 20 tracés Diamino reste l'arbitre.

### Préréglages

`PREREGLAGES_TEMPS` : rapide 30 s, normal 2 min, approfondi 10 min.

## Contrat JSON `seritex.imbrication/v1`

Unités : **millimètres** et **degrés**. Repère : X = longueur du tissu (sens
du rouleau), Y = largeur ; le tracé commence en X = 0, Y = 0 est la lisière
basse.

Le contrat est défini à trois endroits qui doivent rester identiques :
`rust/imbrication/src/contrat.rs`, `src/lib/imbrication/contrat.ts` et ce
document. Un changement incompatible impose `seritex.imbrication/v2`.

### Entrée

```json
{
  "version": "seritex.imbrication/v1",
  "tissu": {
    "largeur_utile": 1600,
    "marge_lisiere": 5,
    "longueur_max": 12000
  },
  "espacement": 2,
  "calcul": {
    "temps_max_s": 120,
    "graine": 42,
    "effort": null,
    "fichier_annulation": null
  },
  "pieces": [
    {
      "id": "manche-d-M",
      "contour": [[0, 30], [0, 410], [220, 273], [165, 97]],
      "quantite": 4,
      "rotations": [0, 180],
      "miroir": true
    }
  ]
}
```

| Champ | Sens |
|---|---|
| `tissu.largeur_utile` | Largeur utile (mm), lisières retirées. |
| `tissu.marge_lisiere` | Marge supplémentaire le long de chaque lisière (mm). Défaut 0. |
| `tissu.longueur_max` | Longueur de table (mm). **Signalée** en sortie si dépassée, jamais imposée au moteur. |
| `espacement` | Distance minimale entre pièces **et entre une pièce et les bords** (mm). Défaut 0. |
| `calcul.temps_max_s` | Temps maximal (s, ≤ 4 h). Toujours respecté. |
| `calcul.graine` | Graine du hasard (entier ≥ 0). |
| `calcul.effort` | Budget d'effort en itérations. Avec un effort, le résultat est **reproductible**. Sans, le moteur utilise tout le temps (meilleure qualité, non reproductible). |
| `calcul.fichier_annulation` | Géré par `moteur.ts` : ne pas renseigner. |
| `pieces[].id` | Identifiant libre, unique, renvoyé dans les placements. |
| `pieces[].contour` | Contour extérieur (≥ 3 points, sans croisement). Les trous ne sont pas pris en charge : seul le contour extérieur compte. |
| `pieces[].quantite` | Nombre d'exemplaires à poser. |
| `pieces[].rotations` | Angles autorisés. `[0, 180]` = la pièce suit le sens du rouleau ; `[0]` = sens unique ; `[0, 90, 180, 270]` = cas particuliers. |
| `pieces[].miroir` | Pièce **posée retournée** (symétrie y → -y, droit-fil conservé), par exemple la manche droite d'une paire dont le patron est la gauche. |
| `reprise` | Facultatif : `{ "placements": [...] }`, placements d'une sortie précédente. Le moteur repart de ce tracé au lieu d'en construire un (enchaînement des tranches). |

### Sortie

```json
{
  "version": "seritex.imbrication/v1",
  "statut": "termine",
  "arret": "budget_effort",
  "longueur": 1819.4,
  "largeur_utile": 1600,
  "taux_utilisation": 0.8851,
  "depasse_longueur_max": false,
  "temps_calcul_s": 1.0,
  "effort_utilise": 151,
  "reproductible": true,
  "graine": 7,
  "moteur": { "nom": "sparrow", "version": "0.3.0", "jagua_rs": "1.0.0", "wrapper": "0.1.0" },
  "placements": [
    { "piece_id": "manche-d-M", "x": 712.4, "y": 1189.2, "rotation": 180, "miroir": true }
  ]
}
```

- `statut` : `termine`, `annule` (les placements sont alors la meilleure
  solution trouvée avant l'arrêt), ou `echec` avec
  `erreur: { code, message, piece_id? }`.
- `arret` : `budget_effort`, `budget_temps`, `temps_max` ou `annulation`.
- **Placement** : la transformation s'applique au contour d'**origine**,
  dans cet ordre : symétrie y → -y si `miroir`, rotation de `rotation`
  degrés autour de l'origine, puis translation de (`x`, `y`).
- `longueur` : bord droit de la pièce la plus éloignée.
  `taux_utilisation` = surface des pièces / (longueur × largeur utile).

### Codes d'erreur

| Code | Cause |
|---|---|
| `entree_invalide` | Paramètres refusés par le contrat (Zod). |
| `contour_invalide` | Contour à moins de 3 points, sans surface, ou qui se croise (le message nomme la pièce). |
| `piece_trop_large` | Dans aucun des sens autorisés, la pièce ne tient dans la largeur (marges et espacement compris). |
| `marge_invalide`, `largeur_invalide`, `espacement_invalide`, `temps_invalide`, `effort_invalide` | Paramètre hors limites. |
| `reprise_invalide` | Placements de reprise incohérents avec les pièces. |
| `moteur_absent`, `moteur_plante`, `moteur_delai`, `moteur_sortie_illisible` | Problème d'exécution du moteur. |
| `trace_invalide` | Tracé refusé par le contrôle indépendant de Seritex (calcul en échec). |
| `moteur_interrompu` | Serveur arrêté en route trois fois de suite (calcul en échec). |

## Contrôle indépendant du tracé

`validerTrace(entree, sortie)` recalcule, en double précision et sur les
contours d'origine :

1. chaque pièce placée exactement `quantite` fois ;
2. les rotations autorisées et le retournement respectés ;
3. tout dans la largeur utilisable (marges de lisière comprises) ;
4. aucun chevauchement (y compris une pièce entièrement contenue dans une autre) ;
5. l'espacement respecté.

Le moteur calcule en flottants 32 bits. Un chevauchement n'est donc signalé
qu'au-delà de 0,01 mm, et un espacement manquant qu'au-delà de 0,05 mm. Ces
écarts n'ont aucune portée physique à la coupe. La longueur et le taux
d'utilisation qui font foi sont ceux recalculés par cette fonction.

## Reproductibilité et budget

- **Mode effort** (`effort` renseigné) : même entrée + même graine + même
  effort = même tracé, sur n'importe quelle machine, tant que le temps
  maximal n'est pas atteint avant. La sortie l'indique (`reproductible: true`).
- **Mode temps** (`effort: null`) : le moteur s'arrête au chronomètre. Le
  résultat dépend de la vitesse de la machine.
- Une itération n'a pas une durée fixe : rapides au début, elles
  s'allongent à mesure que le tracé se resserre (constaté : 200 itérations
  en 1 s, puis environ 7 par seconde). Les préréglages de l'interface
  (rapide, normal, approfondi) seront calibrés en Phase 2 à partir du banc
  d'essai.

## Installer, construire, tester

```bash
# Une seule fois : Rust (la version exacte est figée par rust/imbrication/rust-toolchain.toml)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal

npm run build:imbrication   # Rust → WebAssembly + version.json + THIRD_PARTY_LICENSES
npm run test:imbrication    # contrat, contours, validation, moteur réel (WASM)
(cd rust/imbrication && cargo test --release)   # tests du module Rust
```

`src/lib/imbrication/moteur/version.json` donne les versions embarquées et
l'empreinte SHA-256 du `.wasm`.

## Banc d'essai (arbitre face à Diamino)

```bash
npm run bench:imbrication -- <dossier-de-cas> --budgets 30,120,600 [--natif <binaire>]
```

Pour chaque cas et chaque budget : calcul, contrôle indépendant, comparaison
à la référence. Le banc produit `resultats.csv` et `rapport.md` dans
`bench-imbrication/<date>/` (dossier ignoré par git).

Un cas est un fichier `<cas>.json`, soit une entrée v1, soit une instance
jagua-rs / ESICUP. La référence est un fichier `<cas>.reference.json` :

```json
{ "longueur": 2471.5, "taux_utilisation": 0.874, "source": "Diamino" }
```

Les cas Diamino réels (DXF des pièces, longueur et taux obtenus) passeront
par l'import DXF de la Phase 2.

## Ajouter une contrainte

1. Ajouter le champ au contrat dans les trois endroits (Rust, TypeScript,
   ce document), avec une valeur par défaut qui garde le comportement
   actuel. Si l'ancien comportement change, passer en v2.
2. La traduire pour le moteur dans `rust/imbrication/src/lib.rs`
   (`imbriquer_interne`), en vérifiant d'abord dans le code de sparrow
   qu'elle est réellement appliquée (voir l'exemple du miroir ci-dessous).
3. **La recontrôler dans `validation.ts`** : une contrainte non vérifiée par
   Seritex n'existe pas.
4. Ajouter un cas à `scripts/test-imbrication.ts`, reconstruire le moteur,
   relancer les tests et le banc.

Hors périmètre v1, mais prévu par cette structure : raccord de rayures et
carreaux (contrainte de position par pièce), matelas multi-plis avec gestion
des bouts, zones de défaut du tissu (jagua-rs gère des zones de qualité).

## Limites connues

- **Retournement libre impossible** : jagua-rs sait le décrire, mais
  l'échantillonneur de sparrow 0.3.0 n'essaie jamais de symétrie (vérifié
  dans son code). `miroir` signifie donc « toujours posée retournée ». Les
  paires gauche/droite se décrivent comme deux pièces.
- **Trous intérieurs ignorés** : sparrow refuse les pièces trouées. Seul le
  contour extérieur compte. C'est sans risque, on perd seulement la
  possibilité de poser une petite pièce dans un trou.
- **Arcs dans les DXF** : refusés (aucun gabarit Modaris examiné n'en a).
  À traiter le jour où un fichier réel en contient.
- **Pièces au pli sur tissu tubulaire** : non gérées (une pièce au pli doit
  toucher le bord du tube, contrainte inconnue du moteur). En v1, le calcul
  automatique s'applique au tissu ouvert.
- **Longueur de table** : signalée, pas imposée. Le découpage en plusieurs
  tracés est à prévoir.
- **Précision** : flottants 32 bits dans le moteur. Les contours sont
  ramenés près de l'origine avant le calcul, ce qui garde une précision de
  l'ordre du millième de millimètre sur un tracé de plusieurs mètres.

## Licences

Voir `THIRD_PARTY_LICENSES` (généré par `npm run build:imbrication`).
sparrow : MIT. jagua-rs : MPL-2.0, utilisé sans modification (le copyleft
de la MPL ne s'applique qu'aux fichiers de jagua-rs eux-mêmes). Toutes les
autres dépendances Rust embarquées sont sous MIT, Apache-2.0 ou licence
équivalente.
