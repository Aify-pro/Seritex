"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { swatchColor } from "@/lib/colors";
import { setProductModelColors } from "../../actions";
import { addArticleDimension, addTextileGrammage, setArticleDimensionActive } from "../../fiche-actions";

const input = "h-8 rounded-md border border-border bg-surface px-2 text-sm";

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ error?: string }>, ok: string, after?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      if (res.error) toast.error("Action refusée", { description: res.error });
      else {
        toast.success(ok);
        after?.();
        router.refresh();
      }
    });
  return [pending, run] as const;
}

/** Couleurs dans lesquelles l'article se décline. */
export function ColorAxis({
  productModelId,
  colors,
  selected,
  editable,
}: {
  productModelId: string;
  colors: { id: string; name: string; hex: string | null; code: string | null }[];
  selected: string[];
  editable: boolean;
}) {
  const [pending, run] = useRun();
  const [ids, setIds] = useState<string[]>(selected);
  const dirty = ids.length !== selected.length || ids.some((i) => !selected.includes(i));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {colors.map((c) => {
          const on = ids.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              disabled={!editable || pending}
              onClick={() => setIds(on ? ids.filter((x) => x !== c.id) : [...ids, c.id])}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${on ? "border-brand bg-brand-soft text-brand" : "border-border bg-surface"}`}
            >
              <span className="h-3 w-3 rounded-full border border-border" style={{ background: swatchColor(c) }} />
              {c.name}
            </button>
          );
        })}
      </div>
      {editable && dirty && (
        <Button size="sm" loading={pending} onClick={() => run(() => setProductModelColors(productModelId, ids), "Couleurs enregistrées")}>
          Enregistrer les couleurs ({ids.length})
        </Button>
      )}
    </div>
  );
}

/** Grammages d'un article tissu (une ligne textile par grammage). */
export function GrammageAxis({
  productModelId,
  grammages,
  editable,
}: {
  productModelId: string;
  grammages: { id: string; grammage: number | null; codeCourt: string | null }[];
  editable: boolean;
}) {
  const [pending, run] = useRun();
  const [g, setG] = useState("");
  const [code, setCode] = useState("");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {grammages.map((t) => (
          <Badge key={t.id} tone="neutral">
            {t.grammage ?? "?"} g/m² <span className="ml-1 font-mono">{t.codeCourt ?? "—"}</span>
          </Badge>
        ))}
        {grammages.length === 0 && <span className="text-xs text-foreground-muted">Aucun grammage.</span>}
      </div>
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <input value={g} onChange={(e) => setG(e.target.value)} inputMode="decimal" placeholder="Grammage (g/m²)" className={`${input} w-36`} />
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={5} placeholder="Code court (défaut : le grammage)" className={`${input} w-60`} />
          <Button
            size="sm"
            variant="secondary"
            loading={pending}
            disabled={!g.trim()}
            onClick={() => run(() => addTextileGrammage(productModelId, Number(g.replace(",", ".")), code), "Grammage ajouté", () => { setG(""); setCode(""); })}
          >
            <Plus className="h-3.5 w-3.5" /> Grammage
          </Button>
        </div>
      )}
    </div>
  );
}

/** Dimensions d'un consommable (12 mm, 50 m, S…). */
export function DimensionAxis({
  productModelId,
  dimensions,
  editable,
}: {
  productModelId: string;
  dimensions: { id: string; libelle: string; codeCourt: string; actif: boolean }[];
  editable: boolean;
}) {
  const [pending, run] = useRun();
  const [libelle, setLibelle] = useState("");
  const [code, setCode] = useState("");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {dimensions.map((d) => (
          <button
            key={d.id}
            type="button"
            disabled={!editable || pending}
            onClick={() => run(() => setArticleDimensionActive(d.id, !d.actif), d.actif ? "Dimension retirée" : "Dimension réactivée")}
            title={d.actif ? "Retirer" : "Réactiver"}
          >
            <Badge tone={d.actif ? "brand" : "neutral"}>
              {d.libelle} <span className="ml-1 font-mono">{d.codeCourt}</span>
            </Badge>
          </button>
        ))}
        {dimensions.length === 0 && <span className="text-xs text-foreground-muted">Aucune dimension (le consommable se décline alors en couleurs seulement).</span>}
      </div>
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <input value={libelle} onChange={(e) => setLibelle(e.target.value)} placeholder="Dimension (ex. 12 mm)" className={`${input} w-44`} />
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={4} placeholder="Code court (ex. 12)" className={`${input} w-40`} />
          <Button
            size="sm"
            variant="secondary"
            loading={pending}
            disabled={!libelle.trim() || !code.trim()}
            onClick={() => run(() => addArticleDimension(productModelId, { libelle, code_court: code }), "Dimension ajoutée", () => { setLibelle(""); setCode(""); })}
          >
            <Plus className="h-3.5 w-3.5" /> Dimension
          </Button>
        </div>
      )}
    </div>
  );
}
