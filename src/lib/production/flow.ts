/**
 * Flux de pièces d'une ligne d'ODF, étape par étape et taille par taille
 * (SF-1, migration 0072).
 *
 * Miroir exact de la fonction Postgres `line_stage_flow_detail()`, qui fait
 * autorité : c'est elle que lisent les écrans et elle qui refuse une
 * déclaration au-delà de l'entrée. Ce module pur (aucun accès base) sert au
 * banc de test `npm run test:en-cours` et aux écrans qui simulent une saisie
 * avant de l'envoyer (reste après saisie, bilan).
 *
 * Règles (plan d'exécution §3.2) :
 *   - Entrée = Bonnes + Déchets + En cours, à chaque étape et dans chaque taille ;
 *   - entrée d'une étape = sorties de l'étape précédente : SOMME si les sections
 *     se partagent les pièces (mode « quantite »), MINIMUM si chacune fait une
 *     partie de la pièce (mode « partie ») ;
 *   - entrée de l'étape 1 sans coupe ni stock = répartition de tailles (P1) ;
 *   - coupe : pièces des matelas clôturés ; stock : prélevé ;
 *   - on ne déclare jamais plus que l'entrée.
 */

export type DeclarationType = "bonne" | "dechet" | "premier_choix" | "deuxieme_choix" | "preleve";

export const DECLARATION_TYPE_LABELS: Record<DeclarationType, string> = {
  bonne: "Bonnes",
  dechet: "Déchets",
  premier_choix: "1er choix",
  deuxieme_choix: "2e choix",
  preleve: "Prélevé",
};

/** Catégorie d'atelier (clé) d'une section — null : section sans catégorie. */
export type CategorieCle = "coupe" | "impression" | "couture" | "finition" | "stock" | (string & {}) | null;

/** Types qu'une section peut déclarer, selon sa catégorie (D7 : seule la finition fait du 2e choix). */
export function allowedDeclarationTypes(categorie: CategorieCle): DeclarationType[] {
  switch (categorie) {
    case "coupe":
      return ["dechet"];
    case "stock":
      return ["preleve"];
    case "finition":
      return ["premier_choix", "deuxieme_choix", "dechet"];
    default:
      return ["bonne", "dechet"];
  }
}

/** Une section (sous-ODF) d'une étape du parcours. */
export interface FlowUnit {
  id: string;
  etape: number;
  categorie: CategorieCle;
  /** Partie de la pièce confiée à la section (migration 0069) — null : toute la pièce. */
  partie: string | null;
}

/** Totaux déclarés par une section pour une taille (corrections déjà déduites). */
export interface UnitTotals {
  bonne?: number;
  dechet?: number;
  premier_choix?: number;
  deuxieme_choix?: number;
  preleve?: number;
  /** Coupe : pièces des matelas clôturés. */
  coupe_produit?: number;
}

export interface FlowDetailRow {
  etape: number;
  mode: "quantite" | "partie";
  unitId: string;
  categorie: CategorieCle;
  taille: string;
  entreeEtape: number;
  recu: number;
  bonnes: number;
  dechets: number;
  premierChoix: number;
  deuxiemeChoix: number;
  preleve: number;
  coupeProduit: number;
  reste: number;
}

export interface FlowStageRow {
  etape: number;
  mode: "quantite" | "partie";
  taille: string;
  entree: number;
  bonnes: number;
  dechets: number;
  premierChoix: number;
  deuxiemeChoix: number;
  preleve: number;
  enCours: number;
}

/** Mode d'une étape : « partie » dès qu'une de ses sections (parmi plusieurs) porte une partie. */
export function stageMode(units: Pick<FlowUnit, "partie">[]): "quantite" | "partie" {
  return units.length > 1 && units.some((u) => u.partie) ? "partie" : "quantite";
}

/** Une étape mélange-t-elle sections « par partie » et « par quantité » ? (interdit en v1, Q-SF-6) */
export function isMixedStage(units: Pick<FlowUnit, "partie">[]): boolean {
  if (units.length < 2) return false;
  const withPartie = units.filter((u) => u.partie).length;
  return withPartie > 0 && withPartie < units.length;
}

function bonnesOf(categorie: CategorieCle, t: UnitTotals): number {
  switch (categorie) {
    case "coupe":
      return (t.coupe_produit ?? 0) - (t.dechet ?? 0);
    case "stock":
      return t.preleve ?? 0;
    case "finition":
      return (t.premier_choix ?? 0) + (t.deuxieme_choix ?? 0);
    default:
      return t.bonne ?? 0;
  }
}

/**
 * Détail du flux, par section × taille.
 * @param repartition  répartition de tailles de la ligne (taille → pièces)
 * @param units        sections du parcours (une par sous-ODF)
 * @param totals       totaux déclarés : totals[unitId][taille]
 * @param tailles      ordre d'affichage des tailles (sinon : ordre d'apparition)
 */
export function computeFlowDetail(
  repartition: Record<string, number>,
  units: FlowUnit[],
  totals: Record<string, Record<string, UnitTotals>>,
  tailles?: string[]
): FlowDetailRow[] {
  const allTailles =
    tailles ??
    [
      ...new Set([
        ...Object.keys(repartition),
        ...Object.values(totals).flatMap((byTaille) => Object.keys(byTaille)),
      ]),
    ];
  const etapes = [...new Set(units.map((u) => u.etape))].sort((a, b) => a - b);
  const rows: FlowDetailRow[] = [];
  let prev: Record<string, number> = {};

  etapes.forEach((etape, index) => {
    const stage = units.filter((u) => u.etape === etape);
    const mode = stageMode(stage);
    const hasCoupe = stage.some((u) => u.categorie === "coupe");
    const hasStock = stage.some((u) => u.categorie === "stock");
    const next: Record<string, number> = {};

    for (const taille of allTailles) {
      const perUnit = stage.map((u) => {
        const t = totals[u.id]?.[taille] ?? {};
        return { unit: u, t, b: bonnesOf(u.categorie, t), d: t.dechet ?? 0 };
      });
      const sumB = perUnit.reduce((s, p) => s + p.b, 0);
      const sumD = perUnit.reduce((s, p) => s + p.d, 0);
      const minB = perUnit.length ? Math.min(...perUnit.map((p) => p.b)) : 0;

      let entree: number;
      if (index === 0) {
        entree = repartition[taille] ?? 0;
        if (hasCoupe) entree = Math.max(entree, perUnit.reduce((s, p) => s + (p.t.coupe_produit ?? 0), 0));
        else if (hasStock) entree = Math.max(entree, perUnit.reduce((s, p) => s + (p.t.preleve ?? 0), 0));
      } else {
        entree = prev[taille] ?? 0;
      }

      for (const p of perUnit) {
        const recu = mode === "partie" ? entree : entree - (sumB + sumD - p.b - p.d);
        rows.push({
          etape,
          mode,
          unitId: p.unit.id,
          categorie: p.unit.categorie,
          taille,
          entreeEtape: entree,
          recu,
          bonnes: p.b,
          dechets: p.d,
          premierChoix: p.t.premier_choix ?? 0,
          deuxiemeChoix: p.t.deuxieme_choix ?? 0,
          preleve: p.t.preleve ?? 0,
          coupeProduit: p.t.coupe_produit ?? 0,
          reste: recu - p.b - p.d,
        });
      }
      next[taille] = mode === "partie" ? minB : sumB;
    }
    prev = next;
  });
  return rows;
}

/** Agrégat par étape × taille : Entrée = Bonnes + Déchets + En cours. */
export function aggregateStages(detail: FlowDetailRow[]): FlowStageRow[] {
  const byKey = new Map<string, FlowDetailRow[]>();
  for (const row of detail) {
    const key = `${row.etape}|${row.taille}`;
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  return [...byKey.values()].map((rows) => {
    const partie = rows[0].mode === "partie";
    const pick = (f: (r: FlowDetailRow) => number, partieAgg: (xs: number[]) => number) =>
      partie ? partieAgg(rows.map(f)) : rows.reduce((s, r) => s + f(r), 0);
    const bonnes = pick((r) => r.bonnes, (xs) => Math.min(...xs));
    const dechets = pick((r) => r.dechets, (xs) => Math.max(...xs));
    return {
      etape: rows[0].etape,
      mode: rows[0].mode,
      taille: rows[0].taille,
      entree: rows[0].entreeEtape,
      bonnes,
      dechets,
      premierChoix: pick((r) => r.premierChoix, (xs) => Math.min(...xs)),
      deuxiemeChoix: pick((r) => r.deuxiemeChoix, (xs) => Math.min(...xs)),
      preleve: rows.reduce((s, r) => s + r.preleve, 0),
      enCours: rows[0].entreeEtape - bonnes - dechets,
    };
  });
}

/** Première violation de « jamais plus que l'entrée » (reste négatif), ou null. */
export function firstOverDeclaration(detail: FlowDetailRow[]): FlowDetailRow | null {
  return detail.find((r) => r.reste < 0) ?? null;
}

/**
 * Simule une saisie avant de l'envoyer : ajoute les quantités aux totaux d'une
 * section et renvoie le flux qui en résulterait. Sert au terminal pour
 * afficher le reste et refuser une saisie trop forte sans aller-retour.
 */
export function simulateDeclaration(
  repartition: Record<string, number>,
  units: FlowUnit[],
  totals: Record<string, Record<string, UnitTotals>>,
  unitId: string,
  saisie: { taille: string; type: DeclarationType; quantite: number }[]
): FlowDetailRow[] {
  const copy: Record<string, Record<string, UnitTotals>> = {};
  for (const [id, byTaille] of Object.entries(totals)) {
    copy[id] = Object.fromEntries(Object.entries(byTaille).map(([t, v]) => [t, { ...v }]));
  }
  for (const s of saisie) {
    if (!(s.quantite > 0)) continue;
    const t = ((copy[unitId] ??= {})[s.taille] ??= {});
    t[s.type] = (t[s.type] ?? 0) + s.quantite;
  }
  return computeFlowDetail(repartition, units, copy);
}

/** Bilan d'une ligne (toutes étapes) par taille — même lecture que production_order_balance(). */
export interface BalanceRow {
  taille: string;
  demande: number;
  premierChoix: number;
  deuxiemeChoix: number;
  dechets: number;
  enCours: number;
}

export function lineBalance(repartition: Record<string, number>, stages: FlowStageRow[]): BalanceRow[] {
  const byTaille = new Map<string, BalanceRow>();
  for (const s of stages) {
    const row = byTaille.get(s.taille) ?? {
      taille: s.taille,
      demande: repartition[s.taille] ?? 0,
      premierChoix: 0,
      deuxiemeChoix: 0,
      dechets: 0,
      enCours: 0,
    };
    row.premierChoix += s.premierChoix;
    row.deuxiemeChoix += s.deuxiemeChoix;
    row.dechets += s.dechets;
    row.enCours += s.enCours;
    byTaille.set(s.taille, row);
  }
  return [...byTaille.values()];
}

/** Tous les en-cours d'un bilan sont-ils à zéro ? */
export function balanceIsClosed(rows: BalanceRow[]): boolean {
  return rows.every((r) => r.enCours === 0);
}

/** Lecture des lignes renvoyées par line_stage_flow() (snake_case Postgres). */
export function stageRowFromDb(r: {
  etape: number;
  mode: string;
  taille: string;
  entree: number;
  bonnes: number;
  dechets: number;
  premier_choix: number;
  deuxieme_choix: number;
  preleve: number;
  en_cours: number;
}): FlowStageRow {
  return {
    etape: r.etape,
    mode: r.mode === "partie" ? "partie" : "quantite",
    taille: r.taille,
    entree: r.entree,
    bonnes: r.bonnes,
    dechets: r.dechets,
    premierChoix: r.premier_choix,
    deuxiemeChoix: r.deuxieme_choix,
    preleve: r.preleve,
    enCours: r.en_cours,
  };
}
