"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { STOCK_ETAT_LABELS, type StockEtat } from "@/lib/articles/codification";
import { generateVariants, setStockArticleSageReference, setVariantActive } from "../../actions";

export interface MatrixVariant {
  id: string;
  textileId: string;
  colorId: string;
  sizeId: string;
  code: string;
  sageReference: string | null;
  actif: boolean;
  stockArticles: { id: string; etat: StockEtat; code: string; sageReference: string | null }[];
}

/**
 * Onglet Déclinaisons (COM-0) : une grille par grammage (textile), couleurs en
 * lignes, tailles en colonnes. Chaque case est une déclinaison : son code,
 * activable ; un clic ouvre ses articles stockables (vierge, P, D) et leurs
 * références Sage.
 */
export function VariantMatrix({
  productModelId,
  textiles,
  colors,
  sizes,
  variants,
  editable,
}: {
  productModelId: string;
  textiles: { id: string; nom: string }[];
  colors: { id: string; name: string; code: string }[];
  sizes: { id: string; libelle: string }[];
  variants: MatrixVariant[];
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = variants.find((v) => v.id === openId) ?? null;
  const find = (t: string, c: string, s: string) => variants.find((v) => v.textileId === t && v.colorId === c && v.sizeId === s);

  function generate() {
    startTransition(async () => {
      const res = await generateVariants(productModelId);
      if ("error" in res && res.error) toast.error("Génération refusée", { description: res.error });
      else {
        toast.success(`${(res as { created: number }).created} déclinaison(s) créée(s)`);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-5">
      {editable && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-border p-3">
          <p className="text-xs text-foreground-muted">
            Les déclinaisons combinent les grammages autorisés et les couleurs et tailles déclarées (onglet Général). Une
            combinaison retirée est désactivée, jamais supprimée : son code ne sera jamais réutilisé.
          </p>
          <Button size="sm" onClick={generate} loading={pending}>
            <Wand2 className="h-3.5 w-3.5" /> Générer les déclinaisons
          </Button>
        </div>
      )}

      {textiles.map((t) => (
        <div key={t.id} className="space-y-1.5">
          <p className="text-sm font-medium text-foreground">{t.nom}</p>
          <div className="overflow-x-auto">
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left font-medium text-foreground-muted">Couleur</th>
                  {sizes.map((s) => (
                    <th key={s.id} className="px-1 py-1 text-center font-medium text-foreground-muted">
                      {s.libelle}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {colors.map((c) => (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap px-2 py-1">
                      <span className="mr-1.5 inline-block h-3 w-3 rounded-full border border-border align-middle" style={{ backgroundColor: c.code }} />
                      {c.name}
                    </td>
                    {sizes.map((s) => {
                      const v = find(t.id, c.id, s.id);
                      return (
                        <td key={s.id} className="px-1 py-1">
                          {v ? (
                            <button
                              type="button"
                              onClick={() => setOpenId(v.id)}
                              title={v.code}
                              className={cn(
                                "w-full min-w-[3.5rem] rounded border px-1 py-0.5 font-mono text-[10px]",
                                v.actif ? "border-brand/40 bg-brand-soft/40 text-foreground" : "border-border text-foreground-muted line-through"
                              )}
                            >
                              {v.code.slice(-6)}
                              {(v.stockArticles.some((a) => a.sageReference) || v.sageReference) && <span className="ml-0.5 text-success">●</span>}
                            </button>
                          ) : (
                            <span className="block text-center text-foreground-muted">·</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {open && <VariantDialog key={open.id} variant={open} editable={editable} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function VariantDialog({ variant, editable, onClose }: { variant: MatrixVariant; editable: boolean; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [warning, setWarning] = useState<string | null>(null);

  function saveRef(target: { kind: "stock_article" | "variant"; id: string }, value: string, current: string | null) {
    if (value.trim() === (current ?? "")) return;
    startTransition(async () => {
      const res = await setStockArticleSageReference(target, value);
      if (res.error) toast.error("Référence refusée", { description: res.error });
      else {
        setWarning(res.warning ?? null);
        if (!res.warning) toast.success("Référence Sage enregistrée");
        router.refresh();
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Déclinaison ${variant.code}`} size="md">
      <div className="space-y-4">
        {warning && (
          <p className="flex items-start gap-1.5 rounded-md bg-warning-soft px-2.5 py-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {warning}
          </p>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-foreground-muted">
              <th className="py-1.5">Article stockable</th>
              <th className="py-1.5">Code Seritex</th>
              <th className="py-1.5">Référence Sage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {variant.stockArticles
              .sort((a, b) => ["vierge", "personnalise", "deuxieme_choix"].indexOf(a.etat) - ["vierge", "personnalise", "deuxieme_choix"].indexOf(b.etat))
              .map((a) => (
                <tr key={a.id}>
                  <td className="py-1.5">{STOCK_ETAT_LABELS[a.etat]}</td>
                  <td className="py-1.5 font-mono text-xs">{a.code}</td>
                  <td className="py-1.5">
                    <input
                      defaultValue={a.sageReference ?? ""}
                      disabled={!editable || pending}
                      placeholder="—"
                      maxLength={18}
                      onBlur={(e) => saveRef({ kind: "stock_article", id: a.id }, e.target.value, a.sageReference)}
                      className="h-8 w-40 rounded-md border border-border bg-surface px-2 font-mono text-xs disabled:opacity-70"
                    />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        <p className="text-[11px] text-foreground-muted">
          Par défaut, l&apos;export Sage utilise le code Seritex. Une référence Sage saisie ici la remplace (stock existant
          dans Sage sous un autre code).
        </p>
        {editable && (
          <div className="flex justify-between gap-2">
            <Button
              size="sm"
              variant={variant.actif ? "ghost" : "secondary"}
              loading={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await setVariantActive(variant.id, !variant.actif);
                  if (res.error) toast.error("Modification refusée", { description: res.error });
                  else {
                    onClose();
                    router.refresh();
                  }
                })
              }
            >
              {variant.actif ? "Désactiver la déclinaison" : "Réactiver la déclinaison"}
            </Button>
            <Button size="sm" variant="secondary" onClick={onClose}>
              Fermer
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
