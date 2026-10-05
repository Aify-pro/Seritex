"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createFamily, renameFamily, setFamilyActive } from "./actions";

export interface FamilyRow {
  id: string;
  nom: string;
  parentId: string | null;
  actif: boolean;
  articles: number;
}

const input = "h-8 rounded-md border border-border bg-surface px-2 text-sm";

/** Familles et sous-familles d'articles : ajout, renommage, activation. */
export function FamiliesManager({ rows }: { rows: FamilyRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [nouvelle, setNouvelle] = useState("");
  const [sousDe, setSousDe] = useState<Record<string, string>>({});
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

  const racines = rows.filter((r) => !r.parentId);

  const Line = ({ r, child }: { r: FamilyRow; child?: boolean }) => (
    <div className={`flex flex-wrap items-center gap-2 py-1.5 ${child ? "pl-6" : ""}`}>
      <input
        defaultValue={r.nom}
        disabled={pending}
        aria-label={`Nom de ${r.nom}`}
        onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== r.nom && run(() => renameFamily(r.id, e.target.value), "Nom enregistré")}
        className={`${input} ${child ? "w-56" : "w-64 font-medium"}`}
      />
      <span className="text-xs text-foreground-muted">{r.articles} article(s)</span>
      <button type="button" disabled={pending} onClick={() => run(() => setFamilyActive(r.id, !r.actif), r.actif ? "Désactivée" : "Réactivée")}>
        <Badge tone={r.actif ? "success" : "neutral"}>{r.actif ? "Active" : "Inactive"}</Badge>
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input value={nouvelle} onChange={(e) => setNouvelle(e.target.value)} placeholder="Nouvelle famille (ex. Textile, Mercerie, Vêtements)" className={`${input} w-80`} />
        <Button size="sm" loading={pending} disabled={!nouvelle.trim()} onClick={() => run(() => createFamily(nouvelle, null), "Famille créée", () => setNouvelle(""))}>
          <Plus className="h-3.5 w-3.5" /> Famille
        </Button>
      </div>
      {racines.length === 0 && <p className="text-sm text-foreground-muted">Aucune famille pour le moment.</p>}
      <div className="divide-y divide-border">
        {racines.map((f) => (
          <div key={f.id} className="py-2">
            <Line r={f} />
            {rows
              .filter((s) => s.parentId === f.id)
              .map((s) => (
                <Line key={s.id} r={s} child />
              ))}
            <div className="flex items-center gap-2 py-1 pl-6">
              <input
                value={sousDe[f.id] ?? ""}
                onChange={(e) => setSousDe({ ...sousDe, [f.id]: e.target.value })}
                placeholder={`Sous-famille de ${f.nom}`}
                className={`${input} w-56`}
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={pending || !(sousDe[f.id] ?? "").trim()}
                onClick={() => run(() => createFamily(sousDe[f.id], f.id), "Sous-famille créée", () => setSousDe({ ...sousDe, [f.id]: "" }))}
              >
                <Plus className="h-3.5 w-3.5" /> Sous-famille
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
