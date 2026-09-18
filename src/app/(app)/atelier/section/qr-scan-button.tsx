"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QrScannerDialog } from "@/components/atelier/qr-scanner-dialog";

// Le QR d'en-tête de l'ODF pointe vers /atelier/production/[id], une page
// interdite au chef de section (requireRole ne l'y autorise pas). Le scan
// n'y navigue donc jamais : on extrait juste l'identifiant de l'ODF du texte
// décodé et on redirige vers la file de travail filtrée sur cet ODF.
const ODF_ID_PATTERN = /\/atelier\/production\/([0-9a-fA-F-]{36})/;

/**
 * `sectionId` : le chef de section n'en a pas besoin (il n'a qu'une section),
 * mais un responsable de production ou un administrateur scanne depuis une
 * section qu'il a choisie au sélecteur — la perdre au retour du scan le
 * renverrait sur la première section de la liste, qui n'a en général rien à
 * voir avec le bon qu'il vient de scanner.
 */
export function QrScanButton({ sectionId }: { sectionId?: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)} className="w-full sm:w-auto">
        <QrCode className="h-4 w-4" />
        Scanner
      </Button>
      <QrScannerDialog
        open={open}
        onOpenChange={setOpen}
        title="Scanner le QR code de l'ODF"
        description="Visez le QR code imprimé en en-tête du bon de fabrication."
        pattern={ODF_ID_PATTERN}
        invalidMessage="QR code reconnu, mais il ne correspond pas à un ODF Seritex."
        onMatch={(odfId) => {
          setOpen(false);
          router.push(
            sectionId
              ? `/atelier/section?section=${sectionId}&odf=${odfId}`
              : `/atelier/section?odf=${odfId}`
          );
        }}
      />
    </>
  );
}
