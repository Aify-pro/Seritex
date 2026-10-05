"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updateTextileTechnique } from "../../fiche-actions";

const input = "h-9 w-full rounded-md border border-border bg-surface px-2 text-sm disabled:opacity-70";

/** Caractéristiques d'une matière première (tissu) : servent à la coupe, au placement et au prix de revient. */
export function TextileTechniqueForm({
  textile,
  matieres,
  editable,
}: {
  textile: { id: string; composition: string | null; grammage: number | null; laize_cm: number | null; matiere_id: string | null };
  matieres: { id: string; nom: string }[];
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState({
    composition: textile.composition ?? "",
    grammage: textile.grammage != null ? String(textile.grammage) : "",
    laize_cm: textile.laize_cm != null ? String(textile.laize_cm) : "",
    matiere_id: textile.matiere_id ?? "",
  });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          <span className="mb-1 block text-xs font-medium text-foreground-muted">Grammage (g/m²)</span>
          <input value={v.grammage} disabled={!editable} inputMode="decimal" onChange={(e) => setV({ ...v, grammage: e.target.value })} className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground-muted">Laize (cm)</span>
          <input value={v.laize_cm} disabled={!editable} inputMode="decimal" onChange={(e) => setV({ ...v, laize_cm: e.target.value })} className={input} />
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
