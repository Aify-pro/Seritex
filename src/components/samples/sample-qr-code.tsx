import QRCode from "qrcode";

/**
 * QR code généré à la volée côté serveur (section 5.2 de l'analyse) —
 * jamais stocké comme image en base, cohérent avec le principe "la base ne
 * stocke pas de binaire" (section 3.7). Encode désormais une URL absolue
 * vers la fiche complète (`/echantillons/[sample_number]`) plutôt que le
 * seul numéro : un scan depuis un mobile ouvre directement la fiche
 * (après connexion si besoin — voir `src/lib/supabase/proxy.ts` et le
 * paramètre `next` de la page de connexion), ce qui répond au besoin de
 * suivi de l'échantillon physique depuis l'atelier (question ouverte de la
 * section 12, tranchée par ce chantier).
 *
 * Retiré de l'affichage en liste du module (trop de détail pour un simple
 * aperçu) mais conservé dans la fenêtre de prévisualisation d'une fiche et
 * dans le PDF imprimable — jamais supprimé du modèle, seulement déplacé.
 */
export async function SampleQrCode({ url, label, size = 120 }: { url: string; label: string; size?: number }) {
  const svg = await QRCode.toString(url, {
    type: "svg",
    margin: 1,
    width: size,
    color: { dark: "#111827", light: "#00000000" },
  });

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="rounded-md border border-border bg-white p-2"
        style={{ width: size + 16, height: size + 16 }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <p className="font-mono text-[11px] tracking-wide text-foreground-muted">{label}</p>
      <p className="text-center text-[10px] text-foreground-muted">Scanner pour ouvrir la fiche sur mobile</p>
    </div>
  );
}
