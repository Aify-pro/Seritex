import { roundMoney } from "@/lib/currency";

/**
 * Totaux d'un devis / proforma, dans la devise du devis (arrondis à la
 * précision de la devise : unité pour le F CFA, centimes sinon). Partagé par
 * la création du devis (écriture de total_ht / total_tva / total_amount),
 * l'aperçu du formulaire, la fiche et le PDF, pour qu'un même devis affiche
 * partout les mêmes chiffres.
 *
 * Ordre de calcul : brut (quantité × PU) → remises de ligne → remise globale
 * → HT net → TVA sur le HT net → TTC. L'acompte se calcule sur le TTC.
 *
 * Prix par taille (migration 0068) : une ligne qui porte une répartition
 * (`sizes`) et des prix par taille (`size_prices`) a pour brut la somme
 * quantité × prix de chaque taille — c'est ce qui fait varier le montant quand
 * le client modifie la répartition. Sinon, quantité × PU.
 */
export interface QuoteTotals {
  /** Somme quantité × PU, avant toute remise. */
  brut: number;
  /** Somme des remises propres aux lignes. */
  remiseLignes: number;
  /** Remise globale du devis (appliquée après les remises de ligne). */
  remise: number;
  ht: number;
  tva: number;
  ttc: number;
  acompte: number;
  reste: number;
}

export interface QuoteTotalsLine {
  quantity: number;
  unit_price: number;
  remise_pct?: number;
  /** Répartition par taille : clé de taille → pièces. */
  sizes?: Record<string, number>;
  /** Prix unitaire par taille (migration 0068) — absent : prix unique `unit_price`. */
  size_prices?: Record<string, number>;
}

/** La ligne est-elle chiffrée taille par taille ? */
export function hasSizePrices(line: Pick<QuoteTotalsLine, "size_prices">): boolean {
  return !!line.size_prices && Object.keys(line.size_prices).length > 0;
}

/** Brut d'une ligne, avant remise : Σ pièces × prix de la taille, ou quantité × PU. */
export function lineGross(line: QuoteTotalsLine): number {
  if (hasSizePrices(line)) {
    return Object.entries(line.sizes ?? {}).reduce((sum, [cle, q]) => sum + q * (line.size_prices![cle] ?? 0), 0);
  }
  return line.quantity * line.unit_price;
}

/**
 * PU moyen d'une ligne chiffrée par taille — reporté dans quote_lines.unit_price
 * (colonne lue par line_total et les écrans antérieurs au prix par taille).
 */
export function averageUnitPrice(line: QuoteTotalsLine): number {
  if (!hasSizePrices(line) || line.quantity <= 0) return line.unit_price;
  return Math.round((lineGross(line) / line.quantity) * 100) / 100;
}

/** Total net d'une ligne (après sa remise propre). */
export function lineNet(line: QuoteTotalsLine, currency = "XOF"): number {
  return roundMoney(lineGross(line) * (1 - (line.remise_pct ?? 0) / 100), currency);
}

export function computeQuoteTotals(
  lines: QuoteTotalsLine[],
  remisePct: number,
  tvaRate: number,
  acomptePct = 0,
  currency = "XOF"
): QuoteTotals {
  const r = (v: number) => roundMoney(v, currency);
  const brut = r(lines.reduce((sum, l) => sum + lineGross(l), 0));
  const net = r(lines.reduce((sum, l) => sum + lineNet(l, currency), 0));
  const remiseLignes = r(brut - net);
  const remise = r((net * remisePct) / 100);
  const ht = r(net - remise);
  const tva = r((ht * tvaRate) / 100);
  const ttc = r(ht + tva);
  const acompte = r((ttc * acomptePct) / 100);
  return { brut, remiseLignes, remise, ht, tva, ttc, acompte, reste: r(ttc - acompte) };
}
