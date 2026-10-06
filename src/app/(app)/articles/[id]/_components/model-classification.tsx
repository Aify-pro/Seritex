"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setProductModelClassification, setProductModelTextiles } from "../../actions";

/**
 * Catégorie (→ code du modèle) et matière (A6), dans l'onglet Général
 * (`part="codification"`) ; textiles autorisés — l'axe grammage des
 * déclinaisons — dans l'onglet Déclinaisons (`part="grammages"`).
 */
export function ModelClassification({
  productModelId,
  code,
  categorieId,
  matiereId,
  categories,
  matieres,
  textiles,
  allowedTextileIds,
  editable,
  part,
}: {
  productModelId: string;
  code: string | null;
  categorieId: string | null;
  matiereId: string | null;
  categories: { id: string; nom: string; code_court: string }[];
  matieres: { id: string; nom: string; code_court: string }[];
  textiles: { id: string; nom: string; grammage: number | null; matiere_id: string | null }[];
  allowedTextileIds: string[];
  editable: boolean;
  part: "codification" | "grammages";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [allowed, setAllowed] = useState(allowedTextileIds);
  const candidats = textiles.filter((t) => !matiereId || t.matiere_id === matiereId);

  function save(action: () => Promise<{ error?: string }>, ok: string) {
    startTransition(async () => {
      const res = await action();
      if (res.error) toast.error("Enregistrement refusé", { description: res.error });
      else {
        toast.success(ok);
        router.refresh();
      }
    });
  }

  function toggleTextile(id: string) {
    const next = allowed.includes(id) ? allowed.filter((x) => x !== id) : [...allowed, id];
    setAllowed(next);
    save(() => setProductModelTextiles(productModelId, next), "Grammages enregistrés");
  }

  if (part === "grammages") {
    if (candidats.length === 0) {
      return (
        <p className="text-xs text-foreground-muted">
          Aucun textile {matiereId ? "de cette matière" : ""} — choisissez la matière (onglet Général) et rattachez les textiles à leur
          matière dans Paramètres &gt; Codification.
        </p>
      );
    }
    return (
      <div className="flex flex-wrap gap-2">
        {candidats.map((t) => (
          <label key={t.id} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-sm">
            <input type="checkbox" checked={allowed.includes(t.id)} disabled={!editable || pending} onChange={() => toggleTextile(t.id)} />
            {t.nom}
            {t.grammage ? <span className="text-xs text-foreground-muted">{t.grammage} g/m²</span> : null}
          </label>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <span className="mb-1 block text-xs font-medium text-foreground-muted">Code</span>
          <span className="inline-flex h-9 items-center rounded-md bg-surface-muted px-3 font-mono text-sm">{code ?? "—"}</span>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground-muted">Catégorie</span>
          <select
            value={categorieId ?? ""}
            disabled={!editable || pending || !!code}
            onChange={(e) => save(() => setProductModelClassification(productModelId, { categorieId: e.target.value || null }), "Catégorie enregistrée")}
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm disabled:opacity-70"
          >
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nom} ({c.code_court})
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground-muted">Matière</span>
          <select
            value={matiereId ?? ""}
            disabled={!editable || pending}
            onChange={(e) => save(() => setProductModelClassification(productModelId, { matiereId: e.target.value || null }), "Matière enregistrée")}
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm disabled:opacity-70"
          >
            <option value="">—</option>
            {matieres.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nom} ({m.code_court})
              </option>
            ))}
          </select>
        </label>
      </div>
      {code && <p className="text-[11px] text-foreground-muted">Code attribué : il est figé, la catégorie ne se change plus.</p>}
    </div>
  );
}
