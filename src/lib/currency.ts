/**
 * Devises des devis. Le franc CFA (XOF) est la devise de base ; toute autre
 * devise est convertie via le taux figé sur le devis (quotes.taux_change =
 * F CFA pour 1 unité). Les chiffres sont toujours stockés dans la devise du
 * devis : aucune conversion à l'affichage.
 */
export const BASE_CURRENCY = "XOF";

/** Décimales de la devise (XOF : 0, EUR / USD / GBP : 2) selon ISO 4217. */
export function currencyDecimals(code: string): number {
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Arrondit à la précision de la devise. */
export function roundMoney(value: number, code: string): number {
  const f = 10 ** currencyDecimals(code);
  return Math.round(value * f) / f;
}

/** « 1 234 567 F CFA » / « 1 234,50 € » — espaces ordinaires (compatibles PDF). */
export function formatMoney(value: number | null | undefined, code: string = BASE_CURRENCY): string {
  if (value === null || value === undefined) return "—";
  if (code === BASE_CURRENCY) {
    return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value)} F CFA`;
  }
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: code }).format(value);
}

/** Noms de devise pour le montant en lettres ; repli sur le code ISO. */
const NAMES: Record<string, { one: string; many: string; subOne?: string; subMany?: string }> = {
  XOF: { one: "franc CFA", many: "francs CFA" },
  EUR: { one: "euro", many: "euros", subOne: "centime", subMany: "centimes" },
  USD: { one: "dollar américain", many: "dollars américains", subOne: "cent", subMany: "cents" },
  GBP: { one: "livre sterling", many: "livres sterling", subOne: "penny", subMany: "pence" },
};

export function currencyNames(code: string) {
  return NAMES[code] ?? { one: code, many: code, subOne: "centième", subMany: "centièmes" };
}
