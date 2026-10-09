/**
 * Prix de revient de la sérigraphie (lot 4) — usage interne (Direction),
 * jamais montré au client. Fonctions pures, sans DOM ni base.
 *
 *   coût fixe du travail = écrans × (coût d'un écran + calage × taux horaire)
 *   coût par pièce       = encre + impression + séchage
 *     encre      = Σ écrans : surface × dépôt × (1 + pertes) × prix au kg
 *     impression = écrans × temps par pièce et par écran × taux horaire
 *     séchage    = écrans × coût de séchage par pièce et par passage
 *   pièces imprimées = quantité × (1 + gâche) : la gâche ne compte que la
 *   sérigraphie (le textile gâché relève du prix de revient de l'article).
 */

export type ParametresSerigraphie = {
  /** Film, émulsion, insolation, récupération : F CFA par écran. */
  coutEcran: number;
  /** Calage d'un écran sur la machine, en minutes. */
  calageMin: number;
  /** Taux horaire de l'équipe d'impression, F CFA/h. */
  tauxHoraire: number;
  /** Temps d'impression d'une pièce pour un écran, en secondes. */
  impressionS: number;
  /** Séchage (flash, tunnel) par pièce et par passage, F CFA. */
  sechagePiece: number;
  /** Pièces ratées, en % des pièces bonnes. */
  gachePct: number;
  /** Dépôt d'encre par défaut, g/m². */
  depotGm2: number;
  /** Encre restée dans l'écran, nettoyage : % du dépôt. */
  perteEncrePct: number;
  /** Prix de l'encre au kg quand l'article n'a pas de prix d'achat. */
  prixEncreKg: number | null;
  /** Surface moyenne d'une couleur pour la grille proposée, cm². */
  surfaceRefCm2: number;
  /** Quantité de référence pour la grille proposée. */
  quantiteRef: number;
};

export type EcranChiffre = {
  libelle: string;
  /** Surface imprimée par pièce, cm². */
  surfaceCm2: number;
  /** Dépôt propre à l'encre (g/m²), sinon celui des paramètres. */
  depotGm2?: number | null;
  /** Prix de l'encre au kg (achat + frais d'approche), sinon le prix par défaut. */
  prixKg?: number | null;
};

export type LigneEcran = EcranChiffre & {
  grammesPiece: number;
  coutEncrePiece: number | null;
  prixParDefaut: boolean;
};

export type Chiffrage = {
  ecrans: LigneEcran[];
  fixe: { ecrans: number; calage: number; total: number };
  parPiece: { encre: number; impression: number; sechage: number; total: number };
  quantite: number;
  piecesImprimees: number;
  total: number;
  /** Coût de revient sérigraphie par pièce bonne. */
  parPieceBonne: number;
  /** Écrans dont l'encre n'a aucun prix (ni article ni défaut) : encre comptée 0, à signaler. */
  prixManquants: string[];
};

const arrondi = (v: number) => Math.round(v * 100) / 100;

export function chiffrer(p: ParametresSerigraphie, ecrans: EcranChiffre[], quantite: number): Chiffrage {
  const n = ecrans.length;
  const prixManquants: string[] = [];
  const lignes: LigneEcran[] = ecrans.map((e) => {
    const depot = e.depotGm2 && e.depotGm2 > 0 ? e.depotGm2 : p.depotGm2;
    const grammesPiece = (e.surfaceCm2 / 10_000) * depot * (1 + p.perteEncrePct / 100);
    const prix = e.prixKg ?? p.prixEncreKg;
    if (prix == null) prixManquants.push(e.libelle);
    return {
      ...e,
      grammesPiece,
      coutEncrePiece: prix == null ? null : (grammesPiece / 1000) * prix,
      prixParDefaut: e.prixKg == null && p.prixEncreKg != null,
    };
  });
  const fixeEcrans = n * p.coutEcran;
  const fixeCalage = n * (p.calageMin / 60) * p.tauxHoraire;
  const encre = lignes.reduce((s, l) => s + (l.coutEncrePiece ?? 0), 0);
  const impression = n * (p.impressionS / 3600) * p.tauxHoraire;
  const sechage = n * p.sechagePiece;
  const variable = encre + impression + sechage;
  const q = Math.max(1, Math.round(quantite));
  const piecesImprimees = Math.ceil(q * (1 + p.gachePct / 100));
  const total = fixeEcrans + fixeCalage + variable * piecesImprimees;
  return {
    ecrans: lignes,
    fixe: { ecrans: arrondi(fixeEcrans), calage: arrondi(fixeCalage), total: arrondi(fixeEcrans + fixeCalage) },
    parPiece: { encre: arrondi(encre), impression: arrondi(impression), sechage: arrondi(sechage), total: arrondi(variable) },
    quantite: q,
    piecesImprimees,
    total: arrondi(total),
    parPieceBonne: arrondi(total / q),
    prixManquants,
  };
}

export type LigneGrille = {
  nbCouleurs: number;
  /** → print_costs.cout_piece : coût variable par pièce bonne (gâche comprise). */
  coutPiece: number;
  /** Coût total par pièce à la quantité de référence (frais d'écran amortis). */
  parPieceRef: number;
};

/**
 * Grille proposée « coût d'impression par nombre de couleurs », dans la forme
 * qu'attend la simulation des devis (src/lib/pricing.ts, printCostPerPiece) :
 * un coût par pièce selon le nombre de couleurs, plus des frais par écran
 * amortis sur la quantité. Chaque couleur couvre la surface de référence.
 */
export function grilleProposee(p: ParametresSerigraphie, nbMax = 7): { lignes: LigneGrille[]; fraisEcran: number } {
  const fraisEcran = arrondi(p.coutEcran + (p.calageMin / 60) * p.tauxHoraire);
  const lignes = Array.from({ length: nbMax }, (_, i) => {
    const nb = i + 1;
    const c = chiffrer(p, Array.from({ length: nb }, (_, k) => ({ libelle: `Couleur ${k + 1}`, surfaceCm2: p.surfaceRefCm2 })), p.quantiteRef);
    return {
      nbCouleurs: nb,
      coutPiece: Math.ceil(c.parPiece.total * (1 + p.gachePct / 100)),
      parPieceRef: Math.ceil(c.parPieceBonne),
    };
  });
  return { lignes, fraisEcran };
}

/** Prix d'un article au kg à partir de son prix d'achat par unité (kg, g ; litre ≈ kg). */
export function prixAuKg(prixAchat: number | null, fraisPct: number, unite: string | null): number | null {
  if (prixAchat == null) return null;
  const parUnite = prixAchat * (1 + fraisPct / 100);
  if (unite === "kg" || unite === "l") return parUnite;
  if (unite === "g") return parUnite * 1000;
  return null;
}
