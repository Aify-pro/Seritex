"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/utils";
import { DECLARATION_TYPE_LABELS, type DeclarationType } from "@/lib/production/flow";
import { correctDeclaration } from "../../../../section/actions";

export interface DeclarationRow {
  id: string;
  taille: string;
  tailleLibelle: string;
  type: DeclarationType;
  quantite: number;
  /** Ce qui reste annulable : quantité d'origine moins les corrections déjà faites. */
  annulable: number;
  corrige: boolean;
  motif: string | null;
  auteur: string;
  createdAt: string;
}

/**
 * Journal des déclarations d'un sous-ODF (SF-1) : rien ne s'efface, une
 * erreur se corrige par une contre-déclaration motivée — réservée au
 * responsable production et à l'administrateur (`correct_declaration`).
 */
export function DeclarationHistory({ rows, canCorrect }: { rows: DeclarationRow[]; canCorrect: boolean }) {
  const [target, setTarget] = useState<DeclarationRow | null>(null);

  if (rows.length === 0) {
    return <p className="px-5 py-4 text-sm text-foreground-muted">Aucune déclaration pour le moment.</p>;
  }

  return (
    <>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
            <div className="min-w-0">
              <p className={r.corrige ? "text-warning" : "text-foreground"}>
                {r.corrige ? "Correction · " : ""}
                {DECLARATION_TYPE_LABELS[r.type]} · {r.tailleLibelle} :{" "}
                <span className="font-semibold tabular-nums">
                  {r.quantite > 0 ? "+" : ""}
                  {r.quantite}
                </span>
              </p>
              {r.motif && <p className="text-xs text-foreground-muted">Motif : {r.motif}</p>}
              <p className="text-[11px] text-foreground-muted">
                {r.auteur} · {formatDateTime(r.createdAt)}
              </p>
            </div>
            {canCorrect && !r.corrige && r.annulable > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setTarget(r)}>
                <Undo2 className="h-3.5 w-3.5" /> Corriger
              </Button>
            )}
          </li>
        ))}
      </ul>
      {target && <CorrectionDialog key={target.id} row={target} onClose={() => setTarget(null)} />}
    </>
  );
}

function CorrectionDialog({ row, onClose }: { row: DeclarationRow; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [quantite, setQuantite] = useState(row.annulable);
  const [motif, setMotif] = useState("");

  function submit() {
    startTransition(async () => {
      const res = await correctDeclaration(row.id, quantite, motif);
      if (res.error) {
        toast.error("Correction refusée", { description: res.error });
        return;
      }
      toast.success("Contre-déclaration enregistrée");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Corriger une déclaration"
      description={`${DECLARATION_TYPE_LABELS[row.type]} · ${row.tailleLibelle} — jusqu'à ${row.annulable} pièce(s) annulable(s). La déclaration d'origine reste au journal.`}
      size="sm"
    >
      <div className="space-y-3">
        <div>
          <label htmlFor="correction-qte" className="block text-xs text-foreground-muted">
            Pièces à annuler
          </label>
          <input
            id="correction-qte"
            type="number"
            min={1}
            max={row.annulable}
            value={quantite}
            onChange={(e) => setQuantite(Math.floor(Number(e.target.value)))}
            className="h-10 w-full rounded-md border border-border bg-surface px-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
        <div>
          <label htmlFor="correction-motif" className="block text-xs text-foreground-muted">
            Motif (obligatoire)
          </label>
          <textarea
            id="correction-motif"
            rows={2}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            className="w-full rounded-md border border-border bg-surface p-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            onClick={submit}
            loading={pending}
            disabled={!motif.trim() || !(quantite > 0) || quantite > row.annulable}
          >
            Enregistrer la correction
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
