"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { generateVariants, setStockArticleSageReference, setVariantActive } from "../../actions";

export interface GridVariant {
  id: string;
  rowKey: string;
  colKey: string;
  code: string;
  sageReference: string | null;
  actif: boolean;
}

/**
 * Déclinaisons d'un tissu (grammage × couleur) ou d'un consommable
 * (dimension × couleur), migration 0102. Chaque case : le code, figé ; un clic
 * ouvre son activation et sa référence Sage. Pas d'articles vierge / P / D :
 * propres aux produits finis.
 */
export function ArticleVariantGrid({
  productModelId,
  rows,
  cols,
  rowLabel,
  variants,
  editable,
}: {
  productModelId: string;
  rows: { key: string; label: string }[];
  cols: { key: string; label: string }[];
  rowLabel: string;
  variants: GridVariant[];
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = variants.find((v) => v.id === openId) ?? null;
  const [ref, setRef] = useState("");
  const find = (r: string, c: string) => variants.find((v) => v.rowKey === r && v.colKey === c);

  const run = (fn: () => Promise<{ error?: string; warning?: string; created?: number }>, ok: (r: { created?: number }) => string) =>
    startTransition(async () => {
      const res = await fn();
      if (res.error) toast.error("Action refusée", { description: res.error });
      else {
        if (res.warning) toast.warning(res.warning);
        toast.success(ok(res));
        router.refresh();
      }
    });

  return (
    <div className="space-y-3">
      {editable && (
        <Button size="sm" loading={pending} onClick={() => run(() => generateVariants(productModelId) as Promise<{ error?: string; created?: number }>, (r) => `${r.created ?? 0} déclinaison(s) créée(s)`)}>
          <Wand2 className="h-3.5 w-3.5" /> Générer les déclinaisons
        </Button>
      )}
      <div className="overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr className="text-left text-xs text-foreground-muted">
              <th className="py-1.5 pr-3">{rowLabel}</th>
              {cols.map((c) => (
                <th key={c.key} className="px-2 py-1.5">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-border">
                <td className="py-1.5 pr-3 font-medium">{r.label}</td>
                {cols.map((c) => {
                  const v = find(r.key, c.key);
                  return (
                    <td key={c.key} className="px-1 py-1">
                      {v ? (
                        <button
                          type="button"
                          onClick={() => {
                            setOpenId(v.id);
                            setRef(v.sageReference ?? "");
                          }}
                          className={cn(
                            "w-full rounded-md border px-2 py-1 text-left font-mono text-xs",
                            v.actif ? "border-border bg-surface hover:bg-surface-muted" : "border-dashed border-border text-foreground-muted line-through",
                            openId === v.id && "ring-2 ring-brand/40"
                          )}
                        >
                          {v.code}
                          {v.sageReference && <span className="block text-[10px] text-foreground-muted no-underline">Sage {v.sageReference}</span>}
                        </button>
                      ) : (
                        <span className="block px-2 py-1 text-xs text-foreground-muted">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface-muted/50 p-3">
          <p className="w-full text-sm font-medium">
            <span className="font-mono">{open.code}</span> — {open.actif ? "active" : "désactivée"}
          </p>
          <label className="text-xs">
            <span className="mb-1 block text-foreground-muted">Référence Sage</span>
            <input value={ref} disabled={!editable} maxLength={18} onChange={(e) => setRef(e.target.value)} className="h-8 w-48 rounded-md border border-border bg-surface px-2 font-mono text-sm" />
          </label>
          {editable && (
            <>
              <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => setStockArticleSageReference({ kind: "variant", id: open.id }, ref), () => "Référence enregistrée")}>
                Enregistrer la référence
              </Button>
              <Button size="sm" variant="ghost" loading={pending} onClick={() => run(() => setVariantActive(open.id, !open.actif), () => (open.actif ? "Déclinaison désactivée" : "Déclinaison réactivée"))}>
                {open.actif ? "Désactiver" : "Réactiver"}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
