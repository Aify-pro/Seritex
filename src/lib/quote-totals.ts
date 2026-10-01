/**
 * Totaux d'un devis / proforma en F CFA (monnaie sans décimale : tout est
 * arrondi à l'unité). Partagé par la création du devis (écriture de
 * total_ht / total_tva / total_amount), l'aperçu du formulaire et le PDF,
 * pour qu'un même devis affiche partout les mêmes chiffres.
 *
 * Ordre de calcul : somme des lignes (brut HT) → remise commerciale →
 * HT net → TVA sur le HT net → TTC. L'acompte se calcule sur le TTC.
 */
export interface QuoteTotals {
  brut: number;
  remise: number;
  ht: number;
  tva: number;
  ttc: number;
  acompte: number;
  reste: number;
}

export function computeQuoteTotals(
  lines: { quantity: number; unit_price: number }[],
  remisePct: number,
  tvaRate: number,
  acomptePct = 0
): QuoteTotals {
  const brut = Math.round(lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0));
  const remise = Math.round((brut * remisePct) / 100);
  const ht = brut - remise;
  const tva = Math.round((ht * tvaRate) / 100);
  const ttc = ht + tva;
  const acompte = Math.round((ttc * acomptePct) / 100);
  return { brut, remise, ht, tva, ttc, acompte, reste: ttc - acompte };
}
