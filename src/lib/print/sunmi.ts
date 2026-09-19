/**
 * Impression directe sur l'imprimante thermique de la tablette Sunmi V3H, via
 * l'app compagnon SunmiPrintBridge (dépôt Aify-pro/sunmi-print-bridge) : un
 * lien `sunmiprint://commands` porte la liste des opérations, la mise en page
 * vit donc ici et non dans l'APK. Rouleau 58 mm : 384 points imprimables.
 *
 * Le navigateur ne sait pas si l'app est installée ni si l'impression a
 * réussi : aucun retour possible en JS.
 */
export type SunmiOp =
  | { op: "align"; v: 0 | 1 | 2 }
  | { op: "text"; v: string; size?: number }
  | { op: "qr"; v: string; module?: number; level?: 0 | 1 | 2 | 3 }
  | { op: "feed"; n: number };

const PRINTABLE_DOTS = 376;

/** Le plus gros module de QR (1 à 16 points) qui tienne dans la largeur imprimable, selon sa densité. */
export function qrModuleSize(qrModules: number) {
  return Math.max(1, Math.min(16, Math.floor(PRINTABLE_DOTS / qrModules)));
}

export function printOnSunmi(ops: SunmiOp[]) {
  window.location.href = `sunmiprint://commands?data=${encodeURIComponent(base64EncodeUtf8(JSON.stringify({ ops })))}`;
}

/** `btoa` n'accepte que du Latin1 : on repasse par les octets UTF-8 du texte (accents). */
function base64EncodeUtf8(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
