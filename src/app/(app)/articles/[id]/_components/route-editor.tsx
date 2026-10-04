"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  addModelRouteStep,
  createModelRoute,
  deleteModelRoute,
  removeModelRouteStep,
  setDefaultModelRoute,
} from "../../actions";

export interface RouteView {
  id: string;
  nom: string;
  parDefaut: boolean;
  steps: { id: string; etape: number; label: string; mode: "quantite" | "partie"; partie: string | null }[];
}

const input = "h-8 rounded-md border border-border bg-surface px-2 text-xs";

/**
 * Parcours types d'un modèle (ART-H) : étapes (section ou catégorie),
 * parallélisme par quantité ou par partie. Point d'entrée Coupe ou Stock ; la
 * Finition est imposée en dernier, à l'application sur un ODF.
 */
export function RouteEditor({
  productModelId,
  routes,
  sections,
  categories,
  editable,
}: {
  productModelId: string;
  routes: RouteView[];
  sections: { id: string; name: string }[];
  categories: { cle: string; nom: string }[];
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [nom, setNom] = useState("");

  function run(action: () => Promise<{ error?: string }>, ok?: string) {
    startTransition(async () => {
      const res = await action();
      if (res.error) toast.error("Action refusée", { description: res.error });
      else {
        if (ok) toast.success(ok);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      {routes.length === 0 && <p className="text-sm text-foreground-muted">Aucun parcours type pour ce modèle.</p>}
      {routes.map((r) => (
        <div key={r.id} className="space-y-2 rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              {r.nom}
              {r.parDefaut && (
                <Badge tone="brand">
                  <Star className="h-3 w-3" /> Par défaut
                </Badge>
              )}
            </p>
            {editable && (
              <div className="flex gap-1.5">
                {!r.parDefaut && (
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setDefaultModelRoute(productModelId, r.id))}>
                    Par défaut
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => deleteModelRoute(r.id), "Parcours supprimé")}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
          <ol className="space-y-1">
            {[...new Set(r.steps.map((s) => s.etape))]
              .sort((a, b) => a - b)
              .map((etape) => (
                <li key={etape} className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-soft font-medium text-brand">{etape}</span>
                  {r.steps
                    .filter((s) => s.etape === etape)
                    .map((s) => (
                      <span key={s.id} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5">
                        {s.label}
                        {s.mode === "partie" && <span className="text-foreground-muted">({s.partie})</span>}
                        {editable && (
                          <button type="button" onClick={() => run(() => removeModelRouteStep(s.id))} className="text-foreground-muted hover:text-danger" aria-label="Retirer">
                            ×
                          </button>
                        )}
                      </span>
                    ))}
                </li>
              ))}
            <li className="flex items-center gap-1.5 text-xs text-foreground-muted">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-muted">∎</span> Finition (imposée)
            </li>
          </ol>
          {editable && (
            <StepForm
              key={r.steps.length}
              nextEtape={Math.max(0, ...r.steps.map((s) => s.etape)) + 1}
              sections={sections}
              categories={categories}
              pending={pending}
              onAdd={(step) => run(() => addModelRouteStep(r.id, step), "Étape ajoutée")}
            />
          )}
        </div>
      ))}
      {editable && (
        <div className="flex flex-wrap items-end gap-2">
          <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Nom du parcours (ex. Imprimé sérigraphie)" className={`${input} w-72`} />
          <Button
            size="sm"
            variant="secondary"
            disabled={!nom.trim() || pending}
            onClick={() => {
              run(() => createModelRoute(productModelId, nom), "Parcours créé");
              setNom("");
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Nouveau parcours
          </Button>
        </div>
      )}
    </div>
  );
}

function StepForm({
  nextEtape,
  sections,
  categories,
  pending,
  onAdd,
}: {
  nextEtape: number;
  sections: { id: string; name: string }[];
  categories: { cle: string; nom: string }[];
  pending: boolean;
  onAdd: (step: { etape: number; sectionId: string | null; categorie: string | null; mode: "quantite" | "partie"; partie: string | null }) => void;
}) {
  const [etape, setEtape] = useState(nextEtape);
  const [cible, setCible] = useState("");
  const [mode, setMode] = useState<"quantite" | "partie">("quantite");
  const [partie, setPartie] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-border pt-2">
      <label className="text-[11px] text-foreground-muted">
        Étape
        <input type="number" min={1} value={etape} onChange={(e) => setEtape(Number(e.target.value))} className={`${input} ml-1 w-14`} />
      </label>
      <select value={cible} onChange={(e) => setCible(e.target.value)} className={input}>
        <option value="">Section ou catégorie…</option>
        <optgroup label="Catégories (première section active)">
          {categories.map((c) => (
            <option key={c.cle} value={`cat:${c.cle}`}>
              {c.nom}
            </option>
          ))}
        </optgroup>
        <optgroup label="Sections">
          {sections.map((s) => (
            <option key={s.id} value={`sec:${s.id}`}>
              {s.name}
            </option>
          ))}
        </optgroup>
      </select>
      <select value={mode} onChange={(e) => setMode(e.target.value as "quantite" | "partie")} className={input}>
        <option value="quantite">Pièces partagées</option>
        <option value="partie">Une partie de la pièce</option>
      </select>
      {mode === "partie" && <input value={partie} onChange={(e) => setPartie(e.target.value)} placeholder="Partie (ex. Manches)" className={`${input} w-32`} />}
      <Button
        size="sm"
        disabled={!cible || pending}
        onClick={() =>
          onAdd({
            etape,
            sectionId: cible.startsWith("sec:") ? cible.slice(4) : null,
            categorie: cible.startsWith("cat:") ? cible.slice(4) : null,
            mode,
            partie: mode === "partie" ? partie : null,
          })
        }
      >
        <Plus className="h-3.5 w-3.5" /> Étape
      </Button>
    </div>
  );
}
