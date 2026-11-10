"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { PRODUCTION_ORDER_STATUS_LABELS, type ProductionOrderStatus } from "@/lib/types/domain";
import { annulerDevis } from "@/app/(app)/commercial/actions";

export interface OdfAAnnuler {
  production_order_id: string;
  reference: string;
  statut: string;
  paquets: number;
  pieces: number;
  annulable: boolean;
}

/**
 * Annulation d'un devis (migration 0174) : administrateur et Direction. La
 * confirmation annonce l'ODF annulé avec le devis et les pièces déjà coupées
 * qui resteront en stock tampon, à réattribuer.
 */
export function CancelQuoteCard({ quoteId, reference, odfs }: { quoteId: string; reference: string; odfs: OdfAAnnuler[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [motif, setMotif] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const bloquant = odfs.find((o) => !o.annulable);
  const aAnnuler = odfs.filter((o) => o.annulable);
  const pieces = aAnnuler.reduce((s, o) => s + o.pieces, 0);

  function confirmer() {
    setError(null);
    startTransition(async () => {
      const res = await annulerDevis(quoteId, motif);
      if (res.error) {
        setError(res.error);
        return;
      }
      toast.success(
        `Devis ${reference} annulé` +
          (res.odf && res.odf.length > 0 ? ` avec ${res.odf.length > 1 ? "les ODF" : "l'ODF"} ${res.odf.join(", ")}` : "") +
          (res.demandeRouverte ? " — demande rouverte" : "")
      );
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Card className="border-danger/20">
      <CardBody className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-medium text-foreground">Annuler ce devis</p>
          <p className="text-xs text-foreground-muted">
            {bloquant
              ? `Impossible : l'ODF ${bloquant.reference} est terminé (marchandise produite).`
              : aAnnuler.length > 0
                ? `L'ODF ${aAnnuler.map((o) => o.reference).join(", ")} sera annulé avec lui.`
                : "Aucun ODF n'est rattaché à ce devis."}
          </p>
        </div>
        <Button variant="secondary" size="sm" disabled={!!bloquant} onClick={() => setOpen(true)}>
          <Ban className="h-3.5 w-3.5" /> Annuler le devis
        </Button>
      </CardBody>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)} title={`Annuler le devis ${reference} ?`}>
          <div className="space-y-3 text-sm">
            {aAnnuler.length > 0 ? (
              <div className="rounded-md border border-danger/30 bg-danger-soft/40 p-3">
                <p className="font-medium text-foreground">
                  {aAnnuler.length > 1 ? "Ces ordres de fabrication seront annulés aussi :" : "Cet ordre de fabrication sera annulé aussi :"}
                </p>
                <ul className="mt-1 space-y-0.5 text-foreground">
                  {aAnnuler.map((o) => (
                    <li key={o.production_order_id}>
                      {o.reference} — {PRODUCTION_ORDER_STATUS_LABELS[o.statut as ProductionOrderStatus] ?? o.statut}
                    </li>
                  ))}
                </ul>
                {pieces > 0 && (
                  <p className="mt-2 text-xs text-foreground-muted">
                    {pieces} pièce(s) déjà coupée(s) restent en stock tampon. Elles pourront être réattribuées à un autre ODF depuis la fiche de
                    l&apos;ODF annulé.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-foreground-muted">Aucun ODF n&apos;est rattaché à ce devis.</p>
            )}
            <p className="text-xs text-foreground-muted">
              Le devis et l&apos;ODF passent au statut « Annulé ». La demande est rouverte si elle n&apos;a pas d&apos;autre devis en cours. Le
              devis Sage n&apos;est pas modifié.
            </p>
            <label className="block space-y-1 text-xs font-medium text-foreground">
              Motif (obligatoire)
              <textarea
                rows={3}
                value={motif}
                onChange={(e) => setMotif(e.target.value)}
                className="w-full rounded-md border border-border bg-surface p-2 text-sm"
              />
            </label>
            {error && <p className="text-xs text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Retour
              </Button>
              <Button variant="danger" loading={pending} disabled={!motif.trim()} onClick={confirmer}>
                {aAnnuler.length > 0 ? "Annuler le devis et l'ODF" : "Annuler le devis"}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </Card>
  );
}
