/**
 * Moteur de tarification — lot D du chantier Tarification (migration 0067).
 *
 * Reprend la logique de la grille Excel « Grille_Prix_Tshirts_Multicolores_
 * Seritex_V7 », en V1 « coûts saisis » : le prix de revient d'un modèle est la
 * somme de composants (tissu, col, confection, charges fixes…) saisis par la
 * Direction, chacun avec une valeur de base et un supplément facultatif par
 * taille (les grandes tailles coûtent plus). Le calcul au kg par Pantone/
 * famille de l'Excel viendra dans une version ultérieure.
 *
 *   PR(taille)  = Σ composants (base + supplément de la taille)
 *               + impressions (coût par pièce selon le nombre de couleurs,
 *                 + frais d'écran amortis sur la quantité)
 *   coefficient = 1 / ((1 − charges) × (1 − marge))   — même formule que l'Excel :
 *                 coût après charges = PR / (1 − charges), puis
 *                 PV = coût après charges / (1 − marge) (marge en % du PV)
 *   PV(taille)  = PR × coefficient, arrondi à la centaine supérieure,
 *                 sauf prix forcé par la Direction pour cette taille.
 *
 * Module pur (aucun accès base, aucun « server-only ») : partagé par les écrans
 * de la Direction et le banc de test scripts/test-pricing.ts. Une donnée
 * manquante ne vaut jamais 0 en silence : elle est remontée dans `warnings`.
 */

export interface CostComponent {
  id: string;
  libelle: string;
  /** Coût par pièce, toutes tailles (F CFA). */
  base: number;
  /** Supplément par clé de taille (« Groupe/Libellé ») — absent = 0. */
  supplements: Record<string, number>;
  /** Composant tissu : remplacé par le tissu pesé dans le prix de revient réel (migration 0070). */
  estTissu?: boolean;
  /**
   * « tissu_calcule » (ART-C, A9) : coût = surface de la taille × (1 + perte)
   * × grammage × prix au kg du textile — base et suppléments ignorés. Résolu
   * par resolveComponents() avant tout calcul de prix.
   */
  mode?: "saisi" | "tissu_calcule";
  /** Chutes de coupe, en % de la surface (composant calculé). */
  pertePct?: number;
}

/** Contexte tissu d'un modèle pour une déclinaison : grammage et prix du textile, surface par taille. */
export interface FabricContext {
  textileNom: string | null;
  /** g/m² */
  grammage: number | null;
  /** F CFA le kg, rendu. */
  prixKg: number | null;
  /** m² par pièce, par clé de taille. */
  surfaces: Record<string, number>;
}

/** Coût tissu d'une pièce : surface × (1 + perte) × grammage (kg/m²) × prix au kg. */
export function fabricCostPerPiece(surfaceM2: number, grammage: number, prixKg: number, pertePct = 0): number {
  return surfaceM2 * (1 + pertePct / 100) * (grammage / 1000) * prixKg;
}

/**
 * Remplace chaque composant « tissu calculé » par un composant concret :
 * base 0 et un supplément par taille égal au coût tissu de la taille. Toutes
 * les autres fonctions de ce module travaillent ensuite sans rien savoir du
 * calcul. Une donnée manquante (grammage, prix au kg, surface d'une taille)
 * est signalée, jamais comptée 0 en silence.
 */
export function resolveComponents(
  components: CostComponent[],
  cles: string[],
  fabric: FabricContext | null
): { components: CostComponent[]; warnings: string[] } {
  const warnings: string[] = [];
  const resolved = components.map((c) => {
    if (c.mode !== "tissu_calcule") return c;
    if (!fabric || !fabric.grammage || !fabric.prixKg) {
      warnings.push(
        `« ${c.libelle} » calculé : ${!fabric ? "aucun textile pour ce modèle" : !fabric.grammage ? `grammage du textile ${fabric.textileNom ?? ""} inconnu` : `prix au kg du textile ${fabric.textileNom ?? ""} non saisi`}`
      );
      return { ...c, base: 0, supplements: {} };
    }
    const supplements: Record<string, number> = {};
    const manquantes: string[] = [];
    for (const cle of cles) {
      const surface = fabric.surfaces[cle];
      if (surface === undefined) manquantes.push(cle.split("/").pop() ?? cle);
      else supplements[cle] = fabricCostPerPiece(surface, fabric.grammage, fabric.prixKg, c.pertePct ?? 0);
    }
    if (manquantes.length) warnings.push(`« ${c.libelle} » calculé : surface de tissu non renseignée pour ${manquantes.join(", ")}`);
    return { ...c, base: 0, supplements };
  });
  return { components: resolved, warnings };
}

export interface PricingParams {
  /** Charges globales, en % du coût après charges (0–99) — lecture de l'Excel. */
  chargesPct: number;
  /** Marge cible, en % du prix de vente (0–99). */
  margePct: number;
  /** Pas d'arrondi du prix de vente (ex. 100 F CFA). */
  arrondi: number;
}

/** Impression retenue : nombre de couleurs d'un emplacement. */
export interface PrintSpec {
  label: string;
  nbCouleurs: number;
}

export interface PrintGrid {
  /** Coût par pièce d'une impression, selon son nombre de couleurs. */
  coutParNbCouleurs: Record<number, number>;
  /** Frais d'écran par couleur, une fois par commande — amortis sur la quantité. */
  fraisEcranParCouleur: number;
}

/** Arrondi au pas supérieur (100 → 1 526,25 devient 1 600) — l'epsilon évite qu'un 1 600,0000001 passe à 1 700. */
export function roundUpTo(value: number, step: number): number {
  if (!(step > 0)) return value;
  return Math.ceil(value / step - 1e-9) * step;
}

/** Coefficient PV / PR ; null si charges ou marge atteignent 100 % (prix infini). */
export function coefficient(p: Pick<PricingParams, "chargesPct" | "margePct">): number | null {
  if (p.chargesPct >= 100 || p.margePct >= 100 || p.chargesPct < 0 || p.margePct < 0) return null;
  return 1 / ((1 - p.chargesPct / 100) * (1 - p.margePct / 100));
}

/** Coût d'un composant pour une taille. */
export function componentCost(c: CostComponent, cle: string): number {
  return c.base + (c.supplements[cle] ?? 0);
}

/** Prix de revient du modèle nu (sans impression) pour une taille. */
export function baseCostForSize(components: CostComponent[], cle: string): number {
  return components.reduce((s, c) => s + componentCost(c, cle), 0);
}

/**
 * Coût des impressions par pièce : coût selon le nombre de couleurs de chaque
 * emplacement, plus les frais d'écran (un écran par couleur) amortis sur la
 * quantité. Un nombre de couleurs absent de la grille est signalé, jamais
 * compté 0 en silence.
 */
export function printCostPerPiece(prints: PrintSpec[], grid: PrintGrid, quantity: number): { cost: number; warnings: string[] } {
  const warnings: string[] = [];
  let cost = 0;
  let ecrans = 0;
  for (const p of prints) {
    const unit = grid.coutParNbCouleurs[p.nbCouleurs];
    if (unit === undefined) warnings.push(`Impression « ${p.label} » : aucun coût défini pour ${p.nbCouleurs} couleur(s)`);
    else cost += unit;
    ecrans += p.nbCouleurs;
  }
  if (ecrans > 0 && grid.fraisEcranParCouleur > 0) {
    if (quantity > 0) cost += (ecrans * grid.fraisEcranParCouleur) / quantity;
    else warnings.push("Frais d'écran non amortis : quantité inconnue");
  }
  return { cost, warnings };
}

export interface SizePrice {
  cle: string;
  /** Prix de revient par pièce. */
  pr: number;
  /** Prix de vente calculé (PR × coefficient, arrondi) — null si le coefficient est impossible. */
  pvCalcule: number | null;
  /** Prix forcé par la Direction pour cette taille, s'il y en a un. */
  pvForce: number | null;
  /** Prix retenu : forcé, sinon calculé. */
  pv: number | null;
  /** Marge réelle sur le prix retenu, en % du prix de vente, après charges (lecture de l'Excel). */
  margeReellePct: number | null;
}

/**
 * Grille de prix d'un modèle, taille par taille : PR (composants + impressions
 * éventuelles), PV calculé, PV forcé, et marge réelle obtenue sur le prix
 * retenu — c'est elle qui dit à la Direction si un prix forcé reste rentable.
 */
export function priceGrid(
  components: CostComponent[],
  cles: string[],
  params: PricingParams,
  options: { forced?: Record<string, number>; extraCostPerPiece?: number } = {}
): { sizes: SizePrice[]; coefficient: number | null; warnings: string[] } {
  const warnings: string[] = [];
  const coef = coefficient(params);
  if (coef === null) warnings.push("Charges ou marge ≥ 100 % : prix de vente impossible à calculer");
  if (components.length === 0) warnings.push("Aucun composant de coût saisi pour ce modèle");

  const extra = options.extraCostPerPiece ?? 0;
  const sizes = cles.map((cle) => {
    const pr = baseCostForSize(components, cle) + extra;
    const pvCalcule = coef === null ? null : roundUpTo(pr * coef, params.arrondi);
    const pvForce = options.forced?.[cle] ?? null;
    const pv = pvForce ?? pvCalcule;
    // Même lecture que l'Excel : coût après charges = PR / (1 − charges) ; la
    // marge est ce qui reste du prix de vente au-delà de ce coût.
    const coutApresCharges = params.chargesPct < 100 ? pr / (1 - params.chargesPct / 100) : null;
    const margeReellePct = pv && coutApresCharges !== null ? ((pv - coutApresCharges) / pv) * 100 : null;
    return { cle, pr, pvCalcule, pvForce, pv, margeReellePct };
  });
  return { sizes, coefficient: coef, warnings };
}

/**
 * Prix d'une taille pour une configuration de devis (lot E) : article nu +
 * impressions. Sans prix forcé : (PR nu + impressions) × coefficient, arrondi.
 * Avec un prix forcé sur l'article nu : ce prix, plus les impressions
 * majorées du même coefficient, arrondi — la Direction fixe le prix du
 * T-shirt, les impressions s'y ajoutent au même taux de marque.
 */
export function salePriceForSize(
  components: CostComponent[],
  cle: string,
  params: PricingParams,
  printCost: number,
  forced: number | null = null
): { pr: number; pv: number | null } {
  const coef = coefficient(params);
  const pr = baseCostForSize(components, cle) + printCost;
  if (coef === null) return { pr, pv: null };
  if (forced !== null) return { pr, pv: printCost > 0 ? roundUpTo(forced + printCost * coef, params.arrondi) : forced };
  return { pr, pv: roundUpTo(pr * coef, params.arrondi) };
}

/**
 * Signature d'une configuration d'impression — clé de la mémoire des prix
 * client (migration 0068) : un prix accordé pour « devant 2 couleurs » ne vaut
 * pas pour « devant + dos 4 couleurs ». Doit rester identique à celle calculée
 * en base (print_signature()) : emplacements triés, « id:couleurs » joints par
 * des virgules ; chaîne vide sans impression.
 */
export function printSignature(zones: { printable_zone_id: string; nb_couleurs: number }[]): string {
  return [...zones]
    .sort((a, b) => (a.printable_zone_id < b.printable_zone_id ? -1 : a.printable_zone_id > b.printable_zone_id ? 1 : 0))
    .map((z) => `${z.printable_zone_id}:${z.nb_couleurs}`)
    .join(",");
}
