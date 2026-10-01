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
}

/** Total net d'une ligne (après sa remise propre). */
export function lineNet(line: QuoteTotalsLine, currency = "XOF"): number {
  return roundMoney(line.quantity * line.unit_price * (1 - (line.remise_pct ?? 0) / 100), currency);
}

export function computeQuoteTotals(
  lines: QuoteTotalsLine[],
  remisePct: number,
  tvaRate: number,
  acomptePct = 0,
  currency = "XOF"
): QuoteTotals {
  const r = (v: number) => roundMoney(v, currency);
  const brut = r(lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0));
  const net = r(lines.reduce((sum, l) => sum + lineNet(l, currency), 0));
  const remiseLignes = r(brut - net);
  const remise = r((net * remisePct) / 100);
  const ht = r(net - remise);
  const tva = r((ht * tvaRate) / 100);
  const ttc = r(ht + tva);
  const acompte = r((ttc * acomptePct) / 100);
  return { brut, remiseLignes, remise, ht, tva, ttc, acompte, reste: r(ttc - acompte) };
}
