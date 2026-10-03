/**
 * Libellé du « client » d'un ODF : son nom, ou « Stock » pour un ODF sans
 * client (fabrication pour le stock, SF-3, D4 — détectée automatiquement).
 */
export const STOCK_LABEL = "Stock";

export function odfClientLabel(companyId: string | null | undefined, companyName: string | null | undefined): string {
  if (!companyId) return STOCK_LABEL;
  return companyName ?? "—";
}
