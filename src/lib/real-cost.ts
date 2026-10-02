/**
 * Prix de revient réel d'un ordre de fabrication — lot F du chantier
 * Tarification (migration 0070).
 *
 * Décision de la direction : le « réel » ne porte que sur le TISSU. Le
 * théorique figé à la validation du devis (quote_cost_snapshots) sert de base ;
 * sa part tissu est remplacée par le tissu réellement consommé :
 *
 *   tissu réel   = kg mesurés (réception tissu − retour stock, table pesees)
 *                  × prix du tissu au kg (rendu)
 *   PR réel      = PR théorique − tissu théorique + tissu réel
 *
 * Col, impressions, confection, charges fixes : repris du théorique. Le prix
 * au kg permet aussi de traduire le tissu théorique en kg, pour comparer les
 * consommations (kg théoriques vs kg pesés).
 *
 * Module pur (aucun accès base) — banc de test : scripts/test-real-cost.ts.
 */

export interface TheoreticalRow {
  quantite: number;
  /** Prix de vente unitaire, en F CFA. */
  prixVenteXof: number;
  /** Prix de revient unitaire théorique (F CFA) — null si la grille manquait. */
  prixRevient: number | null;
  /** Part tissu du prix de revient unitaire théorique (F CFA). */
  tissu: number;
  /** Charges du modèle, en % du coût après charges (lecture de l'Excel). */
  chargesPct: number;
}

export interface RealCostInput {
  rows: TheoreticalRow[];
  /** Tissu consommé mesuré (kg) — null tant qu'aucune pesée de réception. */
  kgMesures: number | null;
  /** Prix du tissu au kg, rendu (F CFA) — null tant qu'il n'est pas renseigné. */
  prixKg: number | null;
}

export interface CostSide {
  prixRevient: number;
  apresCharges: number;
  /** Marge après charges, en % du chiffre d'affaires. */
  margePct: number | null;
}

export interface RealCostResult {
  quantite: number;
  chiffreAffaires: number;
  tissuTheorique: number;
  /** Tissu théorique traduit en kg au prix renseigné — null sans prix au kg. */
  kgTheoriques: number | null;
  theorique: CostSide;
  /** Null tant que kg mesurés ou prix au kg manquent. */
  tissuReel: number | null;
  reel: CostSide | null;
  /** PR réel − PR théorique (F CFA) ; positif = surcoût. */
  ecart: number | null;
  ecartPct: number | null;
  /** Lignes exclues faute de grille (prix de revient théorique inconnu). */
  piecesSansTheorique: number;
  warnings: string[];
}

function side(pr: number, apresCharges: number, ca: number): CostSide {
  return { prixRevient: pr, apresCharges, margePct: ca > 0 ? ((ca - apresCharges) / ca) * 100 : null };
}

export function computeRealCost(input: RealCostInput): RealCostResult {
  const warnings: string[] = [];
  const known = input.rows.filter((r) => r.prixRevient !== null);
  const piecesSansTheorique = input.rows.filter((r) => r.prixRevient === null).reduce((s, r) => s + r.quantite, 0);
  if (piecesSansTheorique > 0) warnings.push(`${piecesSansTheorique} pièce(s) sans prix de revient théorique (grille absente à la validation) : exclues du calcul.`);

  const quantite = known.reduce((s, r) => s + r.quantite, 0);
  const ca = known.reduce((s, r) => s + r.quantite * r.prixVenteXof, 0);
  const prTheo = known.reduce((s, r) => s + r.quantite * (r.prixRevient ?? 0), 0);
  const tissuTheo = known.reduce((s, r) => s + r.quantite * r.tissu, 0);
  // Coût après charges, ligne à ligne (les charges peuvent différer d'un modèle à l'autre).
  const apresCharges = (prixDeRevient: (r: TheoreticalRow) => number) =>
    known.reduce((s, r) => s + (r.quantite * prixDeRevient(r)) / (1 - r.chargesPct / 100), 0);
  const theorique = side(prTheo, apresCharges((r) => r.prixRevient ?? 0), ca);

  if (tissuTheo <= 0 && known.length > 0) warnings.push("Aucun composant « tissu » dans le théorique : le réel ne peut rien remplacer (cochez « tissu » dans la grille du modèle).");
  if (input.kgMesures === null) warnings.push("Aucune pesée de réception tissu sur cet ordre de fabrication.");
  if (input.prixKg === null) warnings.push("Prix du tissu au kg non renseigné.");

  const kgTheoriques = input.prixKg ? tissuTheo / input.prixKg : null;
  if (input.kgMesures === null || input.prixKg === null || known.length === 0) {
    return { quantite, chiffreAffaires: ca, tissuTheorique: tissuTheo, kgTheoriques, theorique, tissuReel: null, reel: null, ecart: null, ecartPct: null, piecesSansTheorique, warnings };
  }

  const tissuReel = input.kgMesures * input.prixKg;
  // Le surcoût tissu se répartit au prorata du tissu théorique de chaque ligne,
  // pour lui appliquer les charges de son modèle.
  const facteur = tissuTheo > 0 ? tissuReel / tissuTheo : 1;
  const prReel = prTheo - tissuTheo + tissuReel;
  const reel = side(prReel, apresCharges((r) => (r.prixRevient ?? 0) - r.tissu + r.tissu * facteur), ca);
  const ecart = prReel - prTheo;
  return {
    quantite,
    chiffreAffaires: ca,
    tissuTheorique: tissuTheo,
    kgTheoriques,
    theorique,
    tissuReel,
    reel,
    ecart,
    ecartPct: prTheo > 0 ? (ecart / prTheo) * 100 : null,
    piecesSansTheorique,
    warnings,
  };
}
