"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setSectionCategory } from "../actions";

/**
 * Rattachement d'une section à une catégorie d'atelier (migration 0036).
 * Les catégories elles-mêmes restent fixes (pas de création libre depuis
 * l'UI) — seule cette réaffectation est administrable ici.
 */
export function SectionCategorySelect({
  sectionId,
  categorieId,
  categories,
}: {
  sectionId: string;
  categorieId: string | null;
  categories: { id: string; nom: string }[];
}) {
  const [value, setValue] = useState(categorieId ?? "");
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <label className="mb-1 block text-[10px] text-foreground-muted">Catégorie d&apos;atelier</label>
      <select
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          const previous = value;
          setValue(next);
          startTransition(async () => {
            const res = await setSectionCategory(sectionId, next || null);
            if (res?.error) {
              setValue(previous);
              toast.error("Enregistrement refusé", { description: res.error });
            } else {
              toast.success("Catégorie mise à jour");
            }
          });
        }}
        className="h-8 rounded-md border border-border bg-surface px-2 text-xs disabled:opacity-50"
      >
        <option value="">Aucune</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nom}
          </option>
        ))}
      </select>
    </div>
  );
}
