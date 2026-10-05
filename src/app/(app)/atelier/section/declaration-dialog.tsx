"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { allowedDeclarationTypes, DECLARATION_TYPE_LABELS, type DeclarationType } from "@/lib/production/flow";
import type { WorkOrderFlowRow } from "@/lib/types/domain";
import { declareProduction } from "./actions";
import { LotCodeInput } from "@/components/atelier/lot-code-input";
import { useSizes } from "./types";

/**
 * Grille de déclaration par taille d'un sous-ODF (SF-1). Pour chaque taille :
 * ce que la section a reçu, ce qu'elle a déjà déclaré et ce qui reste ; les
 * colonnes de saisie dépendent de la catégorie de la section (bonnes et
 * déchets ; en finition, 1er choix, 2e choix et déchets ; en coupe, les
 * déchets seulement — les bonnes viennent des matelas clôturés).
 *
 * La saisie est contrôlée ici pour guider l'opérateur (jamais plus que le
 * reste), mais c'est `declare_production_batch` qui fait autorité.
 */
export function DeclarationDialog({
  open,
  onOpenChange,
  workOrderId,
  workOrderReference,
  categorie,
  flow,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId: string;
  workOrderReference: string;
  categorie: string | null;
  flow: WorkOrderFlowRow[];
}) {
  const router = useRouter();
  const sizes = useSizes();
  const [pending, startTransition] = useTransition();
  const [saisie, setSaisie] = useState<Record<string, Partial<Record<DeclarationType, number>>>>({});
  const [motif, setMotif] = useState("");
  // Lot QR cité par la déclaration (SF-5), facultatif.
  const [lotCode, setLotCode] = useState("");
  const types = allowedDeclarationTypes(categorie);
  const libelle = (cle: string) => sizes.find((s) => s.cle === cle)?.libelle ?? cle.split("/").pop() ?? cle;

  const totalSaisi = (taille: string) => types.reduce((s, t) => s + (saisie[taille]?.[t] ?? 0), 0);
  const exces = flow.filter((r) => totalSaisi(r.taille) > Math.max(r.reste, 0));
  // Coupe : les bonnes viennent des matelas, on ne dépasse jamais. Ailleurs,
  // un dépassement est un surplus (retour de recette C2) : motif obligatoire.
  const depassements = categorie === "coupe" ? exces : [];
  const surplus = categorie !== "coupe" && categorie !== "stock" && exces.length > 0;
  const complement = categorie === "stock" && flow.some((r) => totalSaisi(r.taille) > Math.max(r.reste, 0));
  const total = flow.reduce((s, r) => s + totalSaisi(r.taille), 0);

  const dejaDeclare = (r: WorkOrderFlowRow) => {
    switch (categorie) {
      case "coupe":
        return `${r.coupe_produit} coupée(s) · ${r.dechets} déchet(s)`;
      case "stock":
        return `${r.preleve} prélevée(s)`;
      case "finition":
        return `${r.premier_choix} 1er · ${r.deuxieme_choix} 2e · ${r.dechets} déch.`;
      default:
        return `${r.bonnes} bonne(s) · ${r.dechets} déch.`;
    }
  };

  function setValue(taille: string, type: DeclarationType, raw: string) {
    const value = raw === "" ? 0 : Math.max(0, Math.floor(Number(raw)));
    setSaisie((prev) => ({ ...prev, [taille]: { ...prev[taille], [type]: value } }));
  }

  function remplirReste(taille: string, reste: number) {
    const principal = types[0];
    setSaisie((prev) => ({ ...prev, [taille]: { [principal]: Math.max(reste, 0) } }));
  }

  function submit() {
    const lignes = flow.flatMap((r) =>
      types
        .map((type) => ({ taille: r.taille, type, quantite: saisie[r.taille]?.[type] ?? 0 }))
        .filter((l) => l.quantite > 0)
    );
    startTransition(async () => {
      const res = await declareProduction(workOrderId, lignes, motif || undefined, lotCode.trim() || undefined);
      if (res.error) {
        toast.error("Déclaration refusée", { description: res.error });
        return;
      }
      toast.success(`${workOrderReference} : ${total} pièce(s) déclarée(s)`);
      setSaisie({});
      setMotif("");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Déclarer par taille — ${workOrderReference}`}
      description="Pour chaque taille : reçu, déjà déclaré, reste. Au-delà du reste, les pièces en plus sont un surplus, accepté avec un motif."
      size="lg"
    >
      <div className="space-y-4">
        {flow.length === 0 ? (
          <p className="text-sm text-foreground-muted">Aucune taille à déclarer pour ce sous-ODF.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-foreground-muted">
                  <th className="py-1.5 pr-2">Taille</th>
                  <th className="py-1.5 pr-2 text-right">Reçu</th>
                  <th className="py-1.5 pr-2">Déjà déclaré</th>
                  <th className="py-1.5 pr-2 text-right">Reste</th>
                  {types.map((t) => (
                    <th key={t} className="py-1.5 pr-1 text-center">
                      {DECLARATION_TYPE_LABELS[t]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {flow.map((r) => {
                  const trop = depassements.some((d) => d.taille === r.taille);
                  const enSurplus = surplus && exces.some((d) => d.taille === r.taille);
                  return (
                    <tr key={r.taille} className={cn(trop && "bg-danger-soft/50", enSurplus && "bg-warning-soft/60")}>
                      <td className="py-1.5 pr-2 font-medium text-foreground">{libelle(r.taille)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{r.recu}</td>
                      <td className="py-1.5 pr-2 text-xs text-foreground-muted">{dejaDeclare(r)}</td>
                      <td className="py-1.5 pr-2 text-right">
                        <button
                          type="button"
                          onClick={() => remplirReste(r.taille, r.reste)}
                          title="Tout déclarer dans la première colonne"
                          className="font-semibold tabular-nums text-brand hover:underline"
                        >
                          {r.reste}
                        </button>
                      </td>
                      {types.map((t) => (
                        <td key={t} className="py-1 pr-1">
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            aria-label={`${DECLARATION_TYPE_LABELS[t]} — ${libelle(r.taille)}`}
                            value={saisie[r.taille]?.[t] || ""}
                            placeholder="0"
                            onChange={(e) => setValue(r.taille, t, e.target.value)}
                            className="h-10 w-16 rounded-md border border-border bg-surface px-1.5 text-center text-base outline-none focus:ring-2 focus:ring-brand/30"
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {depassements.length > 0 && (
          <p className="rounded-md bg-danger-soft px-2.5 py-2 text-xs text-danger">
            Plus que le reste pour : {depassements.map((d) => libelle(d.taille)).join(", ")}. On ne déclare jamais plus
            que ce qui a été reçu.
          </p>
        )}

        {surplus && (
          <p className="rounded-md bg-warning-soft px-2.5 py-2 text-xs text-warning">
            Surplus pour : {exces.map((d) => `${libelle(d.taille)} (+${totalSaisi(d.taille) - Math.max(d.reste, 0)})`).join(", ")}. Les pièces
            en plus sont acceptées et suivent la production ; indiquez pourquoi (défaut de tissu, demande spéciale…).
          </p>
        )}

        {(complement || surplus || categorie === "stock") && (
          <div>
            <label htmlFor={`motif-${workOrderId}`} className="block text-xs text-foreground-muted">
              Motif {complement ? "(obligatoire : prélèvement complémentaire)" : surplus ? "(obligatoire : surplus)" : "(facultatif)"}
            </label>
            <input
              id={`motif-${workOrderId}`}
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-surface px-2 text-base outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>
        )}

        <div>
          <p className="mb-1 text-xs text-foreground-muted">Lot concerné (facultatif) — scannez son étiquette</p>
          <LotCodeInput value={lotCode} onChange={setLotCode} disabled={pending} />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            size="md"
            className="w-full sm:w-auto"
            onClick={submit}
            loading={pending}
            disabled={total === 0 || depassements.length > 0 || ((complement || surplus) && !motif.trim())}
          >
            Déclarer {total > 0 ? `${total} pièce(s)` : ""}
          </Button>
          <Button size="md" variant="ghost" className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Reste à traiter par taille, en pastilles compactes (ligne dépliée de la file). */
export function FlowChips({ flow }: { flow: WorkOrderFlowRow[] }) {
  const sizes = useSizes();
  const visibles = flow.filter((r) => r.recu > 0 || r.reste !== 0);
  if (visibles.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {visibles.map((r) => (
        <span
          key={r.taille}
          className={cn(
            "rounded-md border px-2 py-1 text-xs tabular-nums",
            r.reste > 0 ? "border-brand/30 bg-brand-soft/40 text-foreground" : "border-border text-foreground-muted"
          )}
        >
          <span className="font-medium">{sizes.find((s) => s.cle === r.taille)?.libelle ?? r.taille}</span> : reste{" "}
          {r.reste}/{r.recu}
        </span>
      ))}
    </div>
  );
}
