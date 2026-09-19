"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Printer } from "lucide-react";
import QRCode from "qrcode";
import { Dialog } from "@/components/ui/dialog";
import { formatDate, formatDateTime } from "@/lib/utils";
import { printOnSunmi, qrModuleSize } from "@/lib/print/sunmi";
import { useSizes, type MatelasRow } from "./types";

/**
 * Fiche d'un matelas clôturé, en lecture seule : une ligne par taille obtenue,
 * avec son bouton d'impression thermique (une étiquette 52 mm : QR, sous-ODF,
 * taille, date), et en haut la planche A4 qui regroupe toutes les étiquettes
 * du matelas.
 *
 * Le QR renvoie vers la file de la section, filtrée sur l'ODF — la même cible
 * que le QR d'en-tête d'ODF (voir `QrScanButton`).
 */
export function MatelasClosedDialog({
  workOrderId,
  workOrderReference,
  productionOrderId,
  matelas,
  onClose,
}: {
  workOrderId: string;
  workOrderReference: string;
  productionOrderId: string;
  matelas: MatelasRow;
  onClose: () => void;
}) {
  const referentiel = useSizes();
  const [printing, setPrinting] = useState<string | null>(null);
  const cloture = matelas.cloture;
  if (!cloture) return null;

  // Ordre du référentiel, puis toute clé qu'il ne connaîtrait plus.
  const connues = new Set(referentiel.map((t) => t.cle));
  const tailles = [
    ...referentiel.filter((t) => (cloture.quantitesObtenues[t.cle] ?? 0) > 0).map((t) => ({ cle: t.cle, libelle: t.libelle })),
    ...Object.keys(cloture.quantitesObtenues)
      .filter((cle) => !connues.has(cle) && cloture.quantitesObtenues[cle] > 0)
      .map((cle) => ({ cle, libelle: cle })),
  ].map((t) => ({ ...t, quantite: cloture.quantitesObtenues[t.cle] }));
  const total = tailles.reduce((sum, t) => sum + t.quantite, 0);

  function printLabel(taille: { cle: string; libelle: string; quantite: number }) {
    setPrinting(taille.cle);
    const url = `${window.location.origin}/atelier/section?odf=${productionOrderId}`;
    const modules = QRCode.create(url, { errorCorrectionLevel: "M" }).modules.size;
    printOnSunmi([
      { op: "align", v: 1 },
      { op: "text", v: "SERITEX\n", size: 56 },
      { op: "feed", n: 1 },
      { op: "qr", v: url, module: qrModuleSize(modules), level: 1 },
      { op: "feed", n: 1 },
      { op: "text", v: `${workOrderReference}\n`, size: 36 },
      { op: "text", v: `${taille.libelle} · ${taille.quantite} pcs\n`, size: 30 },
      { op: "text", v: `${formatDate(cloture!.occurredAt)}\n`, size: 30 },
      { op: "feed", n: 4 },
    ]);
    toast.info("Impression envoyée à l'imprimante de la tablette", {
      description: "Rien ne sort ? Vérifiez que l'app SunmiPrintBridge est installée sur ce terminal.",
    });
    window.setTimeout(() => setPrinting(null), 1500);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={matelas.reference}
      description={`Matelas terminé le ${formatDateTime(cloture.occurredAt)} — ${total} pièces.`}
      size="lg"
    >
      <div className="space-y-3">
        <p className="flex items-center gap-1.5 text-sm font-medium text-success">
          <CheckCircle2 className="h-4 w-4" /> Terminé
        </p>

        <a
          href={`/api/atelier/matelas/${matelas.id}/etiquettes?workOrderId=${workOrderId}`}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-9 w-full items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-surface-muted"
        >
          <Printer className="h-4 w-4" /> Imprimer toutes les étiquettes (planche A4)
        </a>

        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {tailles.map((t) => (
            <li key={t.cle} className="flex min-h-12 items-center gap-3 bg-surface px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{t.libelle}</span>
              <span className="shrink-0 text-sm tabular-nums text-foreground">{t.quantite} pcs</span>
              <button
                type="button"
                onClick={() => printLabel(t)}
                disabled={printing === t.cle}
                aria-label={`Imprimer l'étiquette ${t.libelle}`}
                title="Imprimer l'étiquette"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-foreground hover:bg-surface-muted disabled:opacity-60"
              >
                <Printer className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
