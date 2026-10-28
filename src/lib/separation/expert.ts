/**
 * Paramètres experts du moteur Reveal (lot 7) : ceux qui changent la
 * réduction des couleurs (catégorie STRUCTURAL de ParameterGenerator). Non
 * renseigné = valeur du profil choisi. Liste unique : validation, interface.
 */

type Choix = { valeur: string; libelle: string };

export type ParamExpert =
  | { cle: string; libelle: string; aide: string; type: "nombre"; min: number; max: number; pas: number }
  | { cle: string; libelle: string; aide: string; type: "choix"; choix: Choix[] }
  | { cle: string; libelle: string; aide: string; type: "booleen" };

export const PARAMS_EXPERT: ParamExpert[] = [
  {
    cle: "engineType",
    libelle: "Algorithme",
    aide: "Façon de réduire les couleurs.",
    type: "choix",
    choix: [
      { valeur: "reveal", libelle: "Reveal (médiane Lab + teintes manquantes)" },
      { valeur: "balanced", libelle: "Équilibré (médiane Lab seule)" },
      { valeur: "distilled", libelle: "Distillé (sur-quantification + couleurs les plus distinctes)" },
      { valeur: "stencil", libelle: "Pochoir (luminance seule)" },
      { valeur: "classic", libelle: "Classique (médiane RVB)" },
      { valeur: "reveal-mk1.5", libelle: "Reveal Mk 1.5 (ancienne version)" },
    ],
  },
  {
    cle: "quantizer",
    libelle: "Découpage",
    aide: "Wu : plus précis sur les aplats ; médiane : plus robuste.",
    type: "choix",
    choix: [
      { valeur: "median-cut", libelle: "Coupe médiane" },
      { valeur: "wu", libelle: "Wu" },
    ],
  },
  {
    cle: "splitMode",
    libelle: "Critère de coupe",
    aide: "Médiane ou variance des boîtes de couleurs.",
    type: "choix",
    choix: [
      { valeur: "median", libelle: "Médiane" },
      { valeur: "variance", libelle: "Variance" },
    ],
  },
  {
    cle: "centroidStrategy",
    libelle: "Couleur retenue par groupe",
    aide: "Saillance : la plus marquante ; volumétrique : la moyenne.",
    type: "choix",
    choix: [
      { valeur: "SALIENCY", libelle: "Saillance" },
      { valeur: "ROBUST_SALIENCY", libelle: "Saillance robuste" },
      { valeur: "VOLUMETRIC", libelle: "Volumétrique (moyenne)" },
    ],
  },
  { cle: "lWeight", libelle: "Poids de la luminosité", aide: "Importance des clairs/foncés (défaut 1,2).", type: "nombre", min: 0, max: 5, pas: 0.1 },
  { cle: "cWeight", libelle: "Poids de la saturation", aide: "Importance des couleurs vives (défaut 2).", type: "nombre", min: 0, max: 5, pas: 0.1 },
  { cle: "bWeight", libelle: "Poids de l'axe bleu-jaune", aide: "Défaut 1.", type: "nombre", min: 0, max: 5, pas: 0.1 },
  { cle: "blackBias", libelle: "Biais du noir", aide: "Favorise les noirs profonds (défaut 3).", type: "nombre", min: 0, max: 20, pas: 0.5 },
  {
    cle: "vibrancyMode",
    libelle: "Vibrance",
    aide: "Renforcement des couleurs vives.",
    type: "choix",
    choix: [
      { valeur: "subtle", libelle: "Subtile" },
      { valeur: "moderate", libelle: "Modérée" },
      { valeur: "aggressive", libelle: "Forte" },
      { valeur: "exponential", libelle: "Exponentielle" },
    ],
  },
  { cle: "vibrancyBoost", libelle: "Intensité de la vibrance", aide: "Défaut 1,4.", type: "nombre", min: 0.5, max: 4, pas: 0.1 },
  { cle: "highlightThreshold", libelle: "Seuil des hautes lumières (L)", aide: "Au-dessus : traité comme un blanc (défaut 90).", type: "nombre", min: 50, max: 100, pas: 1 },
  { cle: "highlightBoost", libelle: "Renfort des hautes lumières", aide: "Défaut 1,5.", type: "nombre", min: 0, max: 5, pas: 0.1 },
  { cle: "shadowPoint", libelle: "Point d'ombre (L)", aide: "En dessous : ombres protégées (défaut 15).", type: "nombre", min: 0, max: 50, pas: 1 },
  { cle: "enablePaletteReduction", libelle: "Fusionner les couleurs proches", aide: "Réduction de palette par écart ΔE.", type: "booleen" },
  { cle: "paletteReduction", libelle: "Écart de fusion (ΔE)", aide: "Couleurs plus proches fusionnées (défaut 6).", type: "nombre", min: 0, max: 30, pas: 0.5 },
  { cle: "hueLockAngle", libelle: "Verrou de teinte (°)", aide: "Zone de teinte protégée (défaut 20).", type: "nombre", min: 0, max: 90, pas: 1 },
  { cle: "enableHueGapAnalysis", libelle: "Récupérer les teintes manquantes", aide: "Ajoute une couleur pour une teinte présente mais absente de la palette.", type: "booleen" },
  {
    cle: "substrateMode",
    libelle: "Support (couleur du textile)",
    aide: "Automatique : le fond détecté ne consomme pas de couleur.",
    type: "choix",
    choix: [
      { valeur: "auto", libelle: "Automatique" },
      { valeur: "force", libelle: "Forcé" },
      { valeur: "off", libelle: "Ignoré" },
    ],
  },
  { cle: "substrateTolerance", libelle: "Tolérance du support", aide: "Défaut 2.", type: "nombre", min: 0, max: 20, pas: 0.5 },
  { cle: "chromaGate", libelle: "Filtre de saturation", aide: "Multiplie le poids de saturation sur les images vives (défaut 1).", type: "nombre", min: 0, max: 3, pas: 0.1 },
  { cle: "neutralSovereigntyThreshold", libelle: "Seuil des neutres", aide: "Part de pixels gris/blancs au-delà de laquelle un neutre est réservé (0 à 1).", type: "nombre", min: 0, max: 1, pas: 0.05 },
  { cle: "refinementPasses", libelle: "Passes d'affinage", aide: "Affinage k-moyennes (0 = aucun, défaut 1).", type: "nombre", min: 0, max: 5, pas: 1 },
];

/** Groupes d'affichage des paramètres experts, dans l'ordre, avec ce qu'ils règlent. */
export const GROUPES_EXPERT: { id: string; titre: string; intro: string; cles: string[] }[] = [
  {
    id: "methode",
    titre: "Méthode de réduction des couleurs",
    intro: "Comment le moteur ramène les milliers de couleurs du visuel à quelques encres.",
    cles: ["engineType", "quantizer", "splitMode", "centroidStrategy", "refinementPasses"],
  },
  {
    id: "criteres",
    titre: "Ce qui compte pour distinguer deux couleurs",
    intro: "Poids donné à la clarté, à l'éclat et à la teinte quand le moteur décide de garder ou de fusionner des couleurs.",
    cles: ["lWeight", "cWeight", "bWeight", "blackBias", "chromaGate"],
  },
  {
    id: "vives",
    titre: "Couleurs vives",
    intro: "Évite qu'une petite zone très colorée disparaisse au profit des grandes zones ternes.",
    cles: ["vibrancyMode", "vibrancyBoost"],
  },
  {
    id: "lumieres",
    titre: "Hautes lumières et ombres",
    intro: "Traitement des zones très claires (proches du blanc) et très sombres (proches du noir).",
    cles: ["highlightThreshold", "highlightBoost", "shadowPoint"],
  },
  {
    id: "fusion",
    titre: "Fusion des couleurs et teintes manquantes",
    intro: "Réduit le nombre d'encres en rapprochant les couleurs voisines, ou au contraire en ajoute une pour une teinte oubliée.",
    cles: ["enablePaletteReduction", "paletteReduction", "hueLockAngle", "enableHueGapAnalysis", "neutralSovereigntyThreshold"],
  },
  {
    id: "support",
    titre: "Fond du visuel (couleur du textile)",
    intro: "Détermine si la couleur de fond compte comme une encre à imprimer ou comme le textile lui-même.",
    cles: ["substrateMode", "substrateTolerance"],
  },
];

/** Explication en langage courant de chaque paramètre : effet, quand y toucher, valeur du profil par défaut. */
export const DETAILS_EXPERT: Record<string, string> = {
  engineType:
    "Reveal (le plus complet) mesure les couleurs en espace Lab et rattrape les teintes oubliées. Équilibré est plus sobre. Distillé garde les couleurs les plus différentes entre elles. Pochoir ne regarde que la clarté : pour des dessins en un seul ton. Changez-le seulement si le résultat par défaut rate une couleur importante.",
  quantizer:
    "Méthode de découpage de l'espace des couleurs. Wu est plus précis sur les aplats nets (logos, textes) ; la coupe médiane est plus tolérante sur les photos et les dégradés.",
  splitMode:
    "Critère pour couper un groupe de couleurs en deux : la médiane répartit les pixels à parts égales, la variance coupe là où le groupe est le plus étalé. La variance isole mieux une petite couleur très distincte.",
  centroidStrategy:
    "Couleur finale retenue pour représenter chaque groupe. Saillance : la plus marquante visuellement (couleurs franches). Volumétrique : la moyenne du groupe (plus fidèle sur les dégradés, mais plus terne).",
  refinementPasses:
    "Nombre de passes qui recentrent chaque encre sur les pixels qui lui sont attribués. 0 : aucune, 1 par défaut ; davantage de passes lisse le résultat mais peut ternir les couleurs franches.",
  lWeight:
    "Importance de la différence de clarté. Plus élevé : le moteur sépare mieux un bleu clair d'un bleu foncé. Plus bas : il les rapproche et utilise moins d'encres.",
  cWeight:
    "Importance de l'éclat (saturation). Plus élevé : les couleurs vives sont mieux défendues face aux gris. Plus bas : les teintes proches mais d'éclat différent sont fusionnées.",
  bWeight:
    "Importance de l'axe bleu-jaune. À augmenter si deux couleurs bleues et jaunâtres sont fusionnées à tort ; 1 convient dans la grande majorité des cas.",
  blackBias:
    "Pousse le moteur à garder un vrai noir profond plutôt que de le confondre avec un gris très foncé. À monter si le noir est absent, à baisser s'il envahit les foncés.",
  chromaGate:
    "Atténue ou renforce le poids de l'éclat sur les visuels très colorés (illustrations, affiches). 1 = neutre ; plus de 1 rend le moteur plus sensible aux nuances d'éclat.",
  vibrancyMode:
    "Intensité du renfort accordé aux couleurs vives : subtile, modérée, forte ou exponentielle. À monter si un petit logo coloré est noyé dans un fond terne.",
  vibrancyBoost:
    "Facteur appliqué par le mode de vibrance choisi. 1,4 par défaut ; vers 1 le renfort disparaît, vers 3 les couleurs vives prennent le dessus.",
  highlightThreshold:
    "Clarté (L, de 0 à 100) au-dessus de laquelle une zone est considérée comme un blanc. Plus bas : davantage de zones claires sont traitées comme du blanc ; plus haut : seuls les blancs francs le sont.",
  highlightBoost:
    "Poids donné aux hautes lumières pour qu'elles ne soient pas absorbées par la couleur voisine. Utile quand des reflets ou des blancs de détail disparaissent.",
  shadowPoint:
    "Clarté (L) en dessous de laquelle une zone est protégée comme une ombre. Plus haut : plus de zones sombres restent distinctes du noir ; plus bas : elles s'y fondent.",
  enablePaletteReduction:
    "Fusionne les encres trop proches pour qu'on les distingue à l'impression. Oui : moins d'encres, donc moins d'écrans et un prix de revient plus bas. Non : toutes les nuances retenues sont gardées.",
  paletteReduction:
    "Écart ΔE sous lequel deux couleurs sont fusionnées (environ 2 : à peine visible, 6 : nettement visible, 15 : très différent). Plus élevé : moins d'encres.",
  hueLockAngle:
    "Largeur de la zone de teinte (en degrés sur le cercle des couleurs) à l'intérieur de laquelle une couleur est protégée de la fusion. Plus large : les teintes différentes restent séparées, mais il y a plus d'encres.",
  enableHueGapAnalysis:
    "Cherche les teintes présentes dans le visuel mais absentes de la palette (par exemple un petit rouge dans une image dominée de bleu) et ajoute une encre pour elles. À désactiver si vous voulez strictement limiter le nombre d'encres.",
  neutralSovereigntyThreshold:
    "Part de pixels gris ou blancs (de 0 à 1) au-delà de laquelle le moteur réserve une encre aux neutres au lieu de les mélanger aux couleurs. Plus bas : réserve plus souvent un gris.",
  substrateMode:
    "Automatique : la couleur de fond détectée (textile) ne compte pas comme encre. Forcé : le fond est toujours retiré. Ignoré : le fond est traité comme une couleur à imprimer, à choisir pour un aplat de fond voulu.",
  substrateTolerance:
    "Écart de couleur accepté pour considérer qu'un pixel appartient encore au fond. Plus haut : le fond « mange » les couleurs voisines et les liserés clairs ; plus bas : le fond détecté est plus strict.",
};

export type ValeursExpert = Record<string, number | string | boolean>;

/** Garde seulement les paramètres connus, du bon type et dans leurs bornes. */
export function nettoyerExpert(v: unknown): ValeursExpert {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out: ValeursExpert = {};
  for (const p of PARAMS_EXPERT) {
    const x = o[p.cle];
    if (x === undefined || x === null || x === "") continue;
    if (p.type === "nombre" && typeof x === "number" && Number.isFinite(x)) out[p.cle] = Math.min(p.max, Math.max(p.min, x));
    else if (p.type === "choix" && typeof x === "string" && p.choix.some((c) => c.valeur === x)) out[p.cle] = x;
    else if (p.type === "booleen" && typeof x === "boolean") out[p.cle] = x;
  }
  return out;
}
