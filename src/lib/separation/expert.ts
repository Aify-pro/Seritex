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
