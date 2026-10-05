"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updateTextileTechnique } from "../../fiche-actions";

const input = "h-9 w-full rounded-md border border-border bg-surface px-2 text-sm disabled:opacity-70";

/**
 * Caractéristiques d'une matière première (tissu) : composition, matière et
 * grammage nominal (le réel varie d'un rouleau à l'autre, mesuré à la
 * production). Pas de laize : elle est propre à chaque rouleau.
 */
export function TextileTechniqueForm({
  textile,
  matieres,
  editable,
}: {
  textile: { id: string; composition: string | null; grammage: number | null; matiere_id: string | null };
  matieres: { id: string; nom: string }[];
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState({
    composition: textile.composition ?? "",
    grammage: textile.grammage != null ? String(textile.grammage) : "",
    matiere_id: textile.matiere_id ?? "",
  });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground-muted">Composition</span>
          <input value={v.composition} disabled={!editable} onChange={(e) => setV({ ...v, composition: e.target.value })} className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground-muted">Matière</span>
          <select value={v.matiere_id} disabled={!editable} onChange={(e) => setV({ ...v, matiere_id: e.target.value })} className={input}>
            <option value="">—</option>
            {matieres.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nom}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground-muted">Grammage nominal (g/m²)</span>
          <input value={v.grammage} disabled={!editable} inputMode="decimal" onChange={(e) => setV({ ...v, grammage: e.target.value })} className={input} />
        </label>
      </div>
      {editable && (
        <Button
          size="sm"
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await updateTextileTechnique(textile.id, v);
              if (res.error) toast.error("Caractéristiques non enregistrées", { description: res.error });
              else {
                toast.success("Caractéristiques enregistrées");
                router.refresh();
              }
            })
          }
        >
          Enregistrer
        </Button>
      )}
    </div>
  );
}
