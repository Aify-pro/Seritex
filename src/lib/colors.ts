/**
 * Couleur d'affichage (pastille) d'une couleur du référentiel : le HEX saisi
 * pour l'aperçu, sinon — anciennes couleurs sans HEX — un `code` déjà au
 * format CSS. `code` est la référence Pantone TCX : jamais passé tel quel à
 * `backgroundColor`.
 */
export function swatchColor(color: { hex?: string | null; code?: string | null } | null | undefined): string | undefined {
  if (!color) return undefined;
  if (color.hex) return color.hex;
  return color.code && /^#[0-9a-f]{3,8}$/i.test(color.code) ? color.code : undefined;
}
