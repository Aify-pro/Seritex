import QRCode from "qrcode";

/**
 * QR code généré à la volée côté serveur à partir du numéro d'identification
 * de l'échantillon (section 5.2 de l'analyse) — jamais stocké comme image en
 * base, cohérent avec le principe "la base ne stocke pas de binaire"
 * (section 3.7). Encode aujourd'hui le numéro seul (lecture simple) ; la
 * question d'encoder à la place une URL vers la fiche complète reste ouverte
 * (section 12) pour un futur scan direct depuis un poste d'atelier.
 */
export async function SampleQrCode({ value, size = 120 }: { value: string; size?: number }) {
  const svg = await QRCode.toString(value, {
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
      <p className="font-mono text-[11px] tracking-wide text-foreground-muted">{value}</p>
    </div>
  );
}
